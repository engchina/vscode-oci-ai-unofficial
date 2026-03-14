import {
  AlertTriangle,
  Loader2,
  RefreshCw,
  Save,
  Slash,
  Sparkles,
  Wand2,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { AgentServiceClient, SkillServiceClient } from "../../services/grpc-client"
import type { AgentSettings, AgentSkillsState, AgentSkillSummary } from "../../services/types"
import Card from "../ui/Card"
import InlineNotice from "../ui/InlineNotice"
import Input from "../ui/Input"
import StatusBadge from "../ui/StatusBadge"
import Toggle from "../ui/Toggle"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
} from "../workbench/WorkbenchActionButtons"

const DEFAULT_SETTINGS: AgentSettings = {
  mode: "chat",
  autoApproval: {
    readFiles: true,
    writeFiles: false,
    executeCommands: false,
    webSearch: true,
    mcpTools: false,
  },
  maxAutoActions: 10,
  enabledTools: {
    readFile: true,
    writeFile: true,
    executeCommand: true,
    webSearch: true,
    browserAction: false,
  },
}

const EMPTY_SKILLS: AgentSkillsState = {
  skills: [],
  watched: false,
  sources: {
    workspaceDirs: [],
    userDirs: [],
    extraDirs: [],
  },
}

export default function AgentSkillsTab() {
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS)
  const [skillsState, setSkillsState] = useState<AgentSkillsState>(EMPTY_SKILLS)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshingSkills, setRefreshingSkills] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [updatingSkillId, setUpdatingSkillId] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const result = await AgentServiceClient.getSettings()
      setSettings(result)
    } catch {
      setSettings(DEFAULT_SETTINGS)
    } finally {
      setLoadingSettings(false)
    }
  }, [])

  const loadSkills = useCallback(async () => {
    try {
      const result = await SkillServiceClient.listSkills()
      setSkillsState(result)
    } catch {
      setSkillsState(EMPTY_SKILLS)
    } finally {
      setLoadingSkills(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
    loadSkills()

    const unsubscribe = SkillServiceClient.subscribeToSkills({
      onResponse: (state) => {
        if (state) {
          setSkillsState(state)
          setLoadingSkills(false)
        }
      },
      onError: () => {},
      onComplete: () => {},
    })

    return unsubscribe
  }, [loadSettings, loadSkills])

  const updateSettings = useCallback((updater: (prev: AgentSettings) => AgentSettings) => {
    setSettings((prev) => {
      const next = updater(prev)
      setDirty(true)
      return next
    })
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await AgentServiceClient.saveSettings(settings)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [settings])

  const handleRefreshSkills = useCallback(async () => {
    setRefreshingSkills(true)
    try {
      await SkillServiceClient.refreshSkills()
    } finally {
      setRefreshingSkills(false)
    }
  }, [])

  const handleToggleSkill = useCallback(async (skill: AgentSkillSummary, enabled: boolean) => {
    setUpdatingSkillId(skill.id)
    try {
      await SkillServiceClient.toggleSkill(skill.id, enabled)
    } finally {
      setUpdatingSkillId(null)
    }
  }, [])

  if (loadingSettings || loadingSkills) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-description" />
      </div>
    )
  }

  const isAgent = settings.mode === "agent"
  const readySkills = skillsState.skills.filter((skill) => skill.effectiveEnabled)
  const blockedSkills = skillsState.skills.filter((skill) => skill.enabled && !skill.effectiveEnabled)

  return (
    <div className="flex flex-col gap-4">
      <Card title="Agent Skills">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                label={`${readySkills.length} Ready`}
                tone={readySkills.length > 0 ? "success" : "neutral"}
              />
              <StatusBadge
                label={`${blockedSkills.length} Blocked`}
                tone={blockedSkills.length > 0 ? "warning" : "neutral"}
              />
              <StatusBadge
                label={skillsState.watched ? "Watching" : "Manual Refresh"}
                tone={skillsState.watched ? "success" : "neutral"}
              />
            </div>
            <p className="mt-2 text-xs text-description">
              OpenClaw-style skills are discovered from bundled, workspace, and optional external
              directories. Use <code>/skills</code> to inspect them in chat, or{" "}
              <code>/skill &lt;id&gt; &lt;task&gt;</code> or its direct slash command to invoke one directly.
            </p>
          </div>
          <WorkbenchActionButton
            variant="secondary"
            onClick={handleRefreshSkills}
            disabled={refreshingSkills}
          >
            {refreshingSkills ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </WorkbenchActionButton>
        </div>

        {skillsState.skills.length === 0 ? (
          <InlineNotice tone="info" size="sm">
            No skills discovered yet. Add a <code>SKILL.md</code> under one of the source
            directories below to make it available.
          </InlineNotice>
        ) : (
          <InlineNotice tone="info" size="sm" icon={<Sparkles size={12} />}>
            Model-invocable skills are advertised to the assistant automatically. Slash-invocable
            skills can be called explicitly from chat.
          </InlineNotice>
        )}

        <SkillSourceList skillsState={skillsState} />
      </Card>

      <Card title="Discovered Skills">
        {skillsState.skills.length === 0 ? (
          <div className="rounded border border-dashed border-[var(--vscode-panel-border)] px-3 py-5 text-center text-xs text-description">
            No skills available.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {skillsState.skills.map((skill) => {
              const skillStatus = getSkillStatus(skill)
              return (
                <div
                  key={skill.id}
                  className="rounded border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{skill.name}</span>
                        <StatusBadge label={skillStatus.label} tone={skillStatus.tone} size="compact" />
                        <StatusBadge label={skill.source} tone="neutral" size="compact" />
                        {skill.modelInvocable && (
                          <StatusBadge label="Auto" tone="success" size="compact" />
                        )}
                        {skill.userInvocable && (
                          <StatusBadge label="Slash" tone="neutral" size="compact" />
                        )}
                        {skill.commandDispatch === "tool" && (
                          <StatusBadge label="Tool Dispatch" tone="warning" size="compact" />
                        )}
                      </div>
                      {skill.description && (
                        <p className="mt-1 text-xs text-description">{skill.description}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <Toggle
                        checked={skill.enabled}
                        onChange={(enabled) => handleToggleSkill(skill, enabled)}
                        label="Enabled"
                        description={updatingSkillId === skill.id ? "Saving..." : undefined}
                        disabled={updatingSkillId === skill.id}
                      />
                    </div>
                  </div>

                  {skill.instructionsPreview && (
                    <div className="mt-3 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5 text-xs text-description">
                      {skill.instructionsPreview}
                    </div>
                  )}

                  <div className="mt-3 grid gap-2 text-xs text-description md:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground">ID</span>
                      <div className="mt-1 break-all font-mono">{skill.id}</div>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Slash</span>
                      <div className="mt-1 break-all font-mono">
                        {skill.slashCommandName ? `/${skill.slashCommandName}` : "—"}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Path</span>
                      <div className="mt-1 break-all font-mono">{skill.filePath}</div>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Dispatch</span>
                      <div className="mt-1 break-all font-mono">
                        {skill.commandDispatch === "tool" && skill.commandTool
                          ? `tool:${skill.commandTool} (${skill.commandArgMode ?? "raw"})`
                          : "model"}
                      </div>
                    </div>
                  </div>

                  {skill.gatingReasons.length > 0 && (
                    <InlineNotice tone="warning" size="sm" icon={<AlertTriangle size={12} />}>
                      {skill.gatingReasons.join(" | ")}
                    </InlineNotice>
                  )}

                  {skill.homepage && (
                    <a
                      href={skill.homepage}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-xs text-[var(--vscode-textLink-foreground)] hover:underline"
                    >
                      Open homepage
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card title="Operation Mode">
        <Toggle
          checked={isAgent}
          onChange={(checked) =>
            updateSettings((state) => ({ ...state, mode: checked ? "agent" : "chat" }))
          }
          label="Agent Mode"
          description="Enable autonomous tool usage and OpenClaw-style skill guidance. Disable it to keep the assistant in regular chat mode."
        />
      </Card>

      <Card title="Built-in Tools">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-description">
            These are the built-in capabilities that remain closest to the current Cline-inspired
            experience.
          </div>
          <Toggle
            checked={settings.enabledTools.readFile}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                enabledTools: { ...state.enabledTools, readFile: checked },
              }))
            }
            label="Read File"
            description="Read files from the current workspace."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.enabledTools.writeFile}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                enabledTools: { ...state.enabledTools, writeFile: checked },
              }))
            }
            label="Write File"
            description="Create or edit files in the workspace."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.enabledTools.executeCommand}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                enabledTools: { ...state.enabledTools, executeCommand: checked },
              }))
            }
            label="Execute Command"
            description="Run terminal commands from the assistant."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.enabledTools.webSearch}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                enabledTools: { ...state.enabledTools, webSearch: checked },
              }))
            }
            label="Web Search"
            description="Allow the assistant to search the web when needed."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.enabledTools.browserAction}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                enabledTools: { ...state.enabledTools, browserAction: checked },
              }))
            }
            label="Browser Action"
            description="Experimental browser automation."
            disabled={!isAgent}
          />
        </div>
      </Card>

      <Card title="Auto-Approval">
        <div className="flex flex-col gap-2">
          <div className="text-xs text-description">
            Auto-approval applies to built-in tools and MCP calls. Skills themselves are prompt
            instructions, not executable permissions.
          </div>

          {isAgent && (
            <InlineNotice tone="warning" size="sm" icon={<AlertTriangle size={12} />}>
              Auto-approved tools can run without another confirmation. Keep write and command
              permissions narrow unless you trust the current workflow.
            </InlineNotice>
          )}

          <Toggle
            checked={settings.autoApproval.readFiles}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                autoApproval: { ...state.autoApproval, readFiles: checked },
              }))
            }
            label="Read Operations"
            description="Auto-approve file reads."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.autoApproval.writeFiles}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                autoApproval: { ...state.autoApproval, writeFiles: checked },
              }))
            }
            label="Write Operations"
            description="Auto-approve file writes."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.autoApproval.executeCommands}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                autoApproval: { ...state.autoApproval, executeCommands: checked },
              }))
            }
            label="Command Execution"
            description="Auto-approve terminal commands."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.autoApproval.webSearch}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                autoApproval: { ...state.autoApproval, webSearch: checked },
              }))
            }
            label="Web Search"
            description="Auto-approve web lookups."
            disabled={!isAgent}
          />
          <Toggle
            checked={settings.autoApproval.mcpTools}
            onChange={(checked) =>
              updateSettings((state) => ({
                ...state,
                autoApproval: { ...state.autoApproval, mcpTools: checked },
              }))
            }
            label="MCP Tools"
            description="Auto-approve direct MCP tool calls."
            disabled={!isAgent}
          />

          <div className="mt-2">
            <Input
              label="Max Consecutive Auto-Actions"
              type="number"
              value={String(settings.maxAutoActions)}
              onChange={(event) => {
                const value = parseInt(event.target.value, 10)
                if (!Number.isNaN(value) && value >= 1 && value <= 100) {
                  updateSettings((state) => ({ ...state, maxAutoActions: value }))
                }
              }}
              disabled={!isAgent}
            />
            <span className="mt-1 block text-xs text-description">
              Maximum consecutive auto-approved actions before the assistant must stop and ask.
            </span>
          </div>
        </div>
      </Card>

      <WorkbenchCompactActionCluster>
        <WorkbenchActionButton variant="primary" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save Settings
        </WorkbenchActionButton>
      </WorkbenchCompactActionCluster>
    </div>
  )
}

function SkillSourceList({ skillsState }: { skillsState: AgentSkillsState }) {
  const sourceRows = [
    ...skillsState.sources.workspaceDirs.map((path) => ({
      label: "Workspace",
      path,
      icon: <Wand2 size={12} />,
    })),
    ...skillsState.sources.extraDirs.map((path) => ({
      label: "Extra",
      path,
      icon: <Sparkles size={12} />,
    })),
    ...skillsState.sources.userDirs.map((path) => ({
      label: "User",
      path,
      icon: <Slash size={12} />,
    })),
    ...(skillsState.sources.bundledDir
      ? [
          {
            label: "Bundled",
            path: skillsState.sources.bundledDir,
            icon: <Sparkles size={12} />,
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-2">
      {sourceRows.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--vscode-panel-border)] px-3 py-3 text-xs text-description">
          No skill source directories configured.
        </div>
      ) : (
        sourceRows.map((row) => (
          <div
            key={`${row.label}-${row.path}`}
            className="rounded border border-[var(--vscode-panel-border)] px-3 py-2"
          >
            <div className="flex items-center gap-2 text-xs font-medium">
              {row.icon}
              <span>{row.label}</span>
            </div>
            <div className="mt-1 break-all font-mono text-xs text-description">{row.path}</div>
          </div>
        ))
      )}
    </div>
  )
}

function getSkillStatus(skill: AgentSkillSummary): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  if (!skill.enabled) {
    return { label: "Disabled", tone: "neutral" }
  }
  if (skill.effectiveEnabled) {
    return { label: "Ready", tone: "success" }
  }
  return { label: "Blocked", tone: "warning" }
}
