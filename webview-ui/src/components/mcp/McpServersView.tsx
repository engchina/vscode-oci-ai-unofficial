import { clsx } from "clsx"
import {
  AlertTriangle,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  Plug,
  RefreshCw,
  Settings2,
  Wrench,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { McpServiceClient } from "../../services/grpc-client"
import type {
  McpPromptPreviewResponse,
  McpResourcePreviewResponse,
  McpServerState,
  McpSmokeTestResult,
} from "../../services/types"
import { useExtensionState } from "../../context/ExtensionStateContext"
import Card from "../ui/Card"
import ToolResultContent from "../chat/ToolResultContent"
import Input from "../ui/Input"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import { WorkbenchActionButton, WorkbenchCompactActionCluster } from "../workbench/WorkbenchActionButtons"

const STATUS_MAP: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  connected: { label: "Connected", tone: "success" },
  connecting: { label: "Connecting...", tone: "warning" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
}

interface McpServersViewProps {
  isHidden?: boolean
}

type PreviewState =
  | {
      kind: "prompt"
      serverName: string
      promptName: string
      argsInput: string
      loading: boolean
      response?: McpPromptPreviewResponse
      error?: string
    }
  | {
      kind: "resource"
      serverName: string
      uri: string
      loading: boolean
      response?: McpResourcePreviewResponse
      error?: string
    }

export default function McpServersView({ isHidden = false }: McpServersViewProps) {
  const { navigateToView, injectChatDraft } = useExtensionState()
  const [servers, setServers] = useState<McpServerState[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSections, setExpandedSections] = useState<Record<string, Set<string>>>({})
  const [runningSmokeTest, setRunningSmokeTest] = useState(false)
  const [smokeTestResult, setSmokeTestResult] = useState<McpSmokeTestResult | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const result = await McpServiceClient.listServers()
      setServers(result.servers)
    } catch {
      setServers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
    const unsubscribe = McpServiceClient.subscribeToServers({
      onResponse: (data) => {
        if (data?.servers) setServers(data.servers)
      },
      onError: () => {},
      onComplete: () => {},
    })
    return unsubscribe
  }, [loadServers])

  const toggleSection = useCallback((serverName: string, section: string) => {
    setExpandedSections((prev) => {
      const serverSections = new Set(prev[serverName] ?? [])
      if (serverSections.has(section)) serverSections.delete(section)
      else serverSections.add(section)
      return { ...prev, [serverName]: serverSections }
    })
  }, [])

  const handleRestart = useCallback(async (name: string) => {
    await McpServiceClient.restartServer(name)
  }, [])

  const handleRunSmokeTest = useCallback(async () => {
    setRunningSmokeTest(true)
    try {
      const result = await McpServiceClient.runSmokeTest()
      setSmokeTestResult(result)
    } finally {
      setRunningSmokeTest(false)
    }
  }, [])

  const handlePreviewPrompt = useCallback(async (serverName: string, promptName: string, argsInput = "") => {
    setPreviewState({
      kind: "prompt",
      serverName,
      promptName,
      argsInput,
      loading: true,
    })
    try {
      const response = await McpServiceClient.previewPrompt({
        serverName,
        promptName,
        args: parsePromptArgsInput(argsInput),
      })
      setPreviewState({
        kind: "prompt",
        serverName,
        promptName,
        argsInput,
        loading: false,
        response,
      })
    } catch (error) {
      setPreviewState({
        kind: "prompt",
        serverName,
        promptName,
        argsInput,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  const handlePreviewResource = useCallback(async (serverName: string, uri: string) => {
    setPreviewState({
      kind: "resource",
      serverName,
      uri,
      loading: true,
    })
    try {
      const response = await McpServiceClient.previewResource({
        serverName,
        uri,
      })
      setPreviewState({
        kind: "resource",
        serverName,
        uri,
        loading: false,
        response,
      })
    } catch (error) {
      setPreviewState({
        kind: "resource",
        serverName,
        uri,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  const handleInjectPreviewToChat = useCallback(() => {
    if (!previewState) {
      return
    }
    const draftText =
      previewState.kind === "prompt"
        ? buildPromptInjectionText(previewState)
        : buildResourceInjectionText(previewState)
    if (!draftText) {
      return
    }
    injectChatDraft({
      text: draftText,
      mode: "append",
      sourceLabel: previewState.kind === "prompt" ? "MCP prompt preview" : "MCP resource preview",
    })
  }, [injectChatDraft, previewState])

  if (loading) {
    return (
      <div className={clsx("flex h-full items-center justify-center", isHidden && "hidden")}>
        <Loader2 size={20} className="animate-spin text-description" />
      </div>
    )
  }

  return (
    <div className={clsx("flex h-full flex-col gap-0 overflow-y-auto", isHidden && "hidden")}>
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plug size={14} className="text-[var(--vscode-icon-foreground)]" />
            <span className="text-sm font-medium">MCP Servers</span>
            <span className="text-xs text-description">({servers.length})</span>
          </div>
          <WorkbenchCompactActionCluster>
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => void handleRunSmokeTest()}
              disabled={runningSmokeTest}
            >
              {runningSmokeTest ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              Smoke Test
            </WorkbenchActionButton>
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => navigateToView("settings")}
            >
              <Settings2 size={12} />
              Configure
            </WorkbenchActionButton>
          </WorkbenchCompactActionCluster>
        </div>
      </div>

      {/* Server list */}
      <div className="flex-1 overflow-y-auto p-3">
        <InlineNotice tone="warning" size="sm" icon={<AlertTriangle size={12} />} className="mb-3">
          Connected servers are live and their tools/resources can now be used from agent mode.
          MCP prompts are also callable from chat with <code>/mcp-prompt &lt;server&gt; &lt;prompt&gt;</code>.
          Agent Skills still provide the higher-level OpenClaw-style workflow on top of MCP.
        </InlineNotice>
        {smokeTestResult ? (
          <Card title="Loopback Smoke Test" className="mb-3">
            <div className="flex items-center gap-2">
              <StatusBadge label={smokeTestResult.ok ? "Passed" : "Failed"} tone={smokeTestResult.ok ? "success" : "danger"} />
              <span className="text-xs text-description">
                {smokeTestResult.transportType} in {smokeTestResult.durationMs} ms
              </span>
            </div>
            <div className="text-xs text-description">
              Uses an ephemeral in-extension MCP server to verify discovery plus live tool, resource, and prompt calls.
            </div>
            <div className="grid gap-2 text-xs text-description md:grid-cols-3">
              <div>Tools: {smokeTestResult.capabilities.tools}</div>
              <div>Resources: {smokeTestResult.capabilities.resources}</div>
              <div>Prompts: {smokeTestResult.capabilities.prompts}</div>
            </div>
            {smokeTestResult.error ? (
              <InlineNotice tone="danger" size="sm">
                {smokeTestResult.error}
              </InlineNotice>
            ) : null}
            <div className="flex flex-col gap-2">
              {smokeTestResult.steps.map((step, index) => (
                <div key={`${step.label}-${index}`} className="rounded border border-[var(--vscode-panel-border)] px-2 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{step.label}</span>
                    <StatusBadge
                      label={step.status}
                      tone={step.status === "success" ? "success" : step.status === "error" ? "danger" : "neutral"}
                      size="compact"
                    />
                  </div>
                  {step.detail ? <div className="mt-1 whitespace-pre-wrap text-description">{step.detail}</div> : null}
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        {previewState ? (
          <Card title={previewState.kind === "prompt" ? "Prompt Preview" : "Resource Preview"} className="mb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="text-xs font-medium text-foreground">
                  {previewState.kind === "prompt"
                    ? `${previewState.serverName} / ${previewState.promptName}`
                    : `${previewState.serverName} / ${previewState.uri}`}
                </div>
                <div className="text-xs text-description">
                  {previewState.kind === "prompt"
                    ? "Preview prompt messages with optional key=value arguments."
                    : "Read a live MCP resource result directly from this view."}
                </div>
              </div>
              <StatusBadge
                label={previewState.loading ? "Loading" : previewState.error ? "Error" : "Ready"}
                tone={previewState.loading ? "warning" : previewState.error ? "danger" : "success"}
              />
            </div>
            {previewState.kind === "prompt" ? (
              <>
                <Input
                  label="Arguments"
                  value={previewState.argsInput}
                  onChange={(event) =>
                    setPreviewState((current) =>
                      current && current.kind === "prompt"
                        ? {
                            ...current,
                            argsInput: event.target.value,
                          }
                        : current,
                    )
                  }
                  placeholder="name=value path=/workspace/src"
                />
                <WorkbenchCompactActionCluster>
                  <WorkbenchActionButton
                    variant="secondary"
                    onClick={() => void handlePreviewPrompt(previewState.serverName, previewState.promptName, previewState.argsInput)}
                    disabled={previewState.loading}
                  >
                    {previewState.loading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                    Preview
                  </WorkbenchActionButton>
                  <WorkbenchActionButton variant="secondary" onClick={() => setPreviewState(null)}>
                    Clear
                  </WorkbenchActionButton>
                  <WorkbenchActionButton
                    variant="primary"
                    onClick={handleInjectPreviewToChat}
                    disabled={previewState.loading || !previewState.response}
                  >
                    Inject to Chat
                  </WorkbenchActionButton>
                </WorkbenchCompactActionCluster>
                <InlineNotice tone="info" size="sm">
                  Suggested slash command:{" "}
                  <code>{buildPromptSlashCommand(previewState.serverName, previewState.promptName, previewState.argsInput)}</code>
                </InlineNotice>
                {previewState.error ? (
                  <InlineNotice tone="danger" size="sm">
                    {previewState.error}
                  </InlineNotice>
                ) : null}
                {previewState.response?.description ? (
                  <div className="text-xs text-description">{previewState.response.description}</div>
                ) : null}
                <div className="flex flex-col gap-2">
                  {previewState.response?.messages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className="rounded border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2 py-2"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <StatusBadge label={message.role} tone={message.role === "assistant" ? "success" : "neutral"} size="compact" />
                      </div>
                      <ToolResultContent content={message.content} />
                    </div>
                  ))}
                  {!previewState.loading && !previewState.error && (previewState.response?.messages.length ?? 0) === 0 ? (
                    <InlineNotice tone="info" size="sm">
                      No prompt messages were returned.
                    </InlineNotice>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <WorkbenchCompactActionCluster>
                  <WorkbenchActionButton
                    variant="secondary"
                    onClick={() => void handlePreviewResource(previewState.serverName, previewState.uri)}
                    disabled={previewState.loading}
                  >
                    {previewState.loading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                    Refresh
                  </WorkbenchActionButton>
                  <WorkbenchActionButton variant="secondary" onClick={() => setPreviewState(null)}>
                    Clear
                  </WorkbenchActionButton>
                  <WorkbenchActionButton
                    variant="primary"
                    onClick={handleInjectPreviewToChat}
                    disabled={previewState.loading || !previewState.response}
                  >
                    Inject to Chat
                  </WorkbenchActionButton>
                </WorkbenchCompactActionCluster>
                {previewState.error ? (
                  <InlineNotice tone="danger" size="sm">
                    {previewState.error}
                  </InlineNotice>
                ) : null}
                {previewState.response ? (
                  <ToolResultContent content={previewState.response.result.content} />
                ) : !previewState.loading ? (
                  <InlineNotice tone="info" size="sm">
                    No resource content was returned.
                  </InlineNotice>
                ) : null}
              </>
            )}
          </Card>
        ) : null}
        {servers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Plug size={32} className="text-description opacity-40" />
            <p className="text-sm text-description">No MCP servers are configured.</p>
            <WorkbenchActionButton
              variant="primary"
              onClick={() => navigateToView("settings")}
            >
              <Settings2 size={14} />
              Add in Settings
            </WorkbenchActionButton>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {servers.map((server) => {
              const statusInfo = STATUS_MAP[server.status] ?? STATUS_MAP.disconnected
              const expanded = expandedSections[server.name] ?? new Set()

              return (
                <Card key={server.name} title={server.name}>
                  <div className="flex flex-col gap-2">
                    {/* Status row */}
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge label={statusInfo.label} tone={statusInfo.tone} />
                      <button
                        className="p-1 text-description hover:text-foreground"
                        title="Restart"
                        onClick={() => handleRestart(server.name)}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>

                    {/* Error */}
                    {server.error && (
                      <InlineNotice tone="danger" size="sm" icon={<AlertTriangle size={12} />}>
                        {server.error}
                      </InlineNotice>
                    )}

                    {/* Transport info */}
                    <div className="text-xs text-description">
                      {server.config.transportType === "stdio" ? (
                        <>
                          Command: <code>{server.config.command} {(server.config.args ?? []).join(" ")}</code>
                          {server.config.cwd ? (
                            <>
                              {" "}in <code>{server.config.cwd}</code>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>URL: <code>{server.config.url}</code></>
                      )}
                    </div>

                    {/* Tools section */}
                    <button
                      className="flex items-center gap-1 text-xs text-description hover:text-foreground"
                      onClick={() => toggleSection(server.name, "tools")}
                    >
                      {expanded.has("tools") ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <Wrench size={12} />
                      <span>Tools ({server.tools.length})</span>
                    </button>
                    {expanded.has("tools") && (
                      <div className="ml-4 flex flex-col gap-1">
                        {server.tools.length === 0 ? (
                          <span className="text-xs text-description italic">No tools</span>
                        ) : (
                          server.tools.map((tool) => (
                            <div key={tool.name} className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
                              <span className="text-xs font-medium">{tool.name}</span>
                              {tool.description && (
                                <span className="ml-2 text-xs text-description">{tool.description}</span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* Resources section */}
                    <button
                      className="flex items-center gap-1 text-xs text-description hover:text-foreground"
                      onClick={() => toggleSection(server.name, "resources")}
                    >
                      {expanded.has("resources") ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <FileText size={12} />
                      <span>Resources ({server.resources.length})</span>
                    </button>
                    {expanded.has("resources") && (
                      <div className="ml-4 flex flex-col gap-1">
                        {server.resources.length === 0 ? (
                          <span className="text-xs text-description italic">No resources</span>
                        ) : (
                          server.resources.map((res) => (
                            <div key={res.uri} className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs font-medium">{res.name}</div>
                                  <div className="text-xs text-description break-all">{res.uri}</div>
                                  {res.description ? <div className="text-xs text-description">{res.description}</div> : null}
                                </div>
                                <WorkbenchActionButton
                                  variant="secondary"
                                  onClick={() => void handlePreviewResource(server.name, res.uri)}
                                >
                                  <Eye size={12} />
                                  Read
                                </WorkbenchActionButton>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    {/* Prompts section */}
                    <button
                      className="flex items-center gap-1 text-xs text-description hover:text-foreground"
                      onClick={() => toggleSection(server.name, "prompts")}
                    >
                      {expanded.has("prompts") ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <MessageSquare size={12} />
                      <span>Prompts ({server.prompts.length})</span>
                    </button>
                    {expanded.has("prompts") && (
                      <div className="ml-4 flex flex-col gap-1">
                        {server.prompts.length === 0 ? (
                          <span className="text-xs text-description italic">No prompts</span>
                        ) : (
                          server.prompts.map((prompt) => (
                            <div key={prompt.name} className="rounded border border-[var(--vscode-panel-border)] px-2 py-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-xs font-medium">{prompt.name}</div>
                                  {prompt.description ? (
                                    <div className="text-xs text-description">{prompt.description}</div>
                                  ) : null}
                                  {prompt.arguments?.length ? (
                                    <div className="text-xs text-description">
                                      Args:{" "}
                                      {prompt.arguments
                                        .map((argument) => `${argument.name}${argument.required ? "*" : ""}`)
                                        .join(", ")}
                                    </div>
                                  ) : null}
                                </div>
                                <WorkbenchActionButton
                                  variant="secondary"
                                  onClick={() =>
                                    void handlePreviewPrompt(
                                      server.name,
                                      prompt.name,
                                      previewState?.kind === "prompt" &&
                                      previewState.serverName === server.name &&
                                      previewState.promptName === prompt.name
                                        ? previewState.argsInput
                                        : "",
                                    )
                                  }
                                >
                                  <Eye size={12} />
                                  Preview
                                </WorkbenchActionButton>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function parsePromptArgsInput(rawValue: string): Record<string, string> {
  const matches = rawValue.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  return Object.fromEntries(
    matches
      .map((token) => {
        const separatorIndex = token.indexOf("=")
        if (separatorIndex <= 0) {
          return undefined
        }
        const key = token.slice(0, separatorIndex).trim()
        const value = token.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "")
        return key ? [key, value] : undefined
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  )
}

function buildPromptSlashCommand(serverName: string, promptName: string, argsInput: string): string {
  const suffix = argsInput.trim()
  return suffix ? `/mcp-prompt ${serverName} ${promptName} ${suffix}` : `/mcp-prompt ${serverName} ${promptName}`
}

function buildPromptInjectionText(previewState: Extract<PreviewState, { kind: "prompt" }>): string {
  if (!previewState.response) {
    return ""
  }
  return [
    "[MCP prompt context]",
    `Server: ${previewState.serverName}`,
    `Prompt: ${previewState.promptName}`,
    Object.keys(previewState.response.args).length > 0 ? `Arguments: ${JSON.stringify(previewState.response.args)}` : "",
    "",
    previewState.response.previewText.trim(),
  ]
    .filter(Boolean)
    .join("\n")
    .trim()
}

function buildResourceInjectionText(previewState: Extract<PreviewState, { kind: "resource" }>): string {
  if (!previewState.response) {
    return ""
  }
  return [
    "[MCP resource context]",
    `Server: ${previewState.serverName}`,
    `URI: ${previewState.uri}`,
    "",
    previewState.response.previewText.trim(),
  ]
    .filter(Boolean)
    .join("\n")
    .trim()
}
