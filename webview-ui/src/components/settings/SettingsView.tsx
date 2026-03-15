import { clsx } from "clsx"
import { Bot, ChevronDown, Info, Loader2, LoaderCircle, Plug, Plus, Save, Server, Settings2, Terminal, Trash2, Users, Wand2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react"
import { AgentServiceClient, StateServiceClient } from "../../services/grpc-client"
import type { AgentSettings, SettingsState } from "../../services/types"
import { runtimeSettingDefaults, runtimeSettingSpecs, runtimeSettingsUiSchema, type RuntimeSettingKey } from "../../generated/runtimeSettings"
import GuardrailDialog from "../common/GuardrailDialog"
import ProfilesCompartmentsView from "../profiles/ProfilesCompartmentsView"
import { DEFAULT_SSH_USERNAME, clampPort, loadSshConfig, saveSshConfig, type HostPreference, type SshConfig } from "../../sshConfig"
import Card from "../ui/Card"
import Input from "../ui/Input"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import Toggle from "../ui/Toggle"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
  WorkbenchIconDestructiveButton,
  WorkbenchInlineActionCluster,
} from "../workbench/WorkbenchActionButtons"
import { WorkbenchLoadingState } from "../workbench/DatabaseWorkbenchChrome"
import {
  buildWorkbenchResourceGuardrailDetails,
  createDeleteResourceGuardrail,
  type WorkbenchGuardrailState,
} from "../workbench/guardrail"
import McpServersTab from "./McpServersTab"
import AgentSkillsTab from "./AgentSkillsTab"
import OcaProxyTab from "./OcaProxyTab"
import {
  renderSettingsSchemaCards,
  renderSettingsSchemaFields,
  renderSettingsSchemaIcon,
  type SettingsSchemaCard,
  type SettingsSchemaFieldSpec,
  type SettingsSchemaFieldUpdater,
} from "./settingsSchemaRenderer"

const DEFAULT_AGENT_SETTINGS: AgentSettings = {
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


interface SettingsViewProps {
  activeTab?: SettingsTab
  onDone?: () => void
  showDone?: boolean
}

export type SettingsTab = "api-config" | "profiles" | "genai" | "runtime" | "terminal" | "mcp-servers" | "agent-skills" | "oca-proxy" | "about"
type UpdateFieldFn = <K extends keyof SettingsState>(field: K, value: SettingsState[K]) => void
type RuntimeUpdateFieldFn = SettingsSchemaFieldUpdater<SettingsState, RuntimeSettingKey>
type GenAiTextFieldKey = "genAiRegion" | "genAiLlmModelId" | "genAiEmbeddingModelId" | "systemPrompt"
type GenAiTextUpdateFieldFn = SettingsSchemaFieldUpdater<SettingsState, GenAiTextFieldKey>
type ApiConfigSchemaValues = Pick<
  SettingsState,
  "region" | "tenancyOcid" | "userOcid" | "fingerprint" | "privateKey" | "privateKeyPassphrase"
> & {
  uploadKeyFile: string
}
type ApiConfigFieldKey =
  | "region"
  | "tenancyOcid"
  | "userOcid"
  | "fingerprint"
  | "uploadKeyFile"
  | "privateKey"
  | "privateKeyPassphrase"
type ApiConfigUpdateFieldFn = SettingsSchemaFieldUpdater<ApiConfigSchemaValues, ApiConfigFieldKey>

const GENAI_TEXT_FIELD_SPECS = {
  genAiRegion: {
    kind: "string",
    defaultValue: "",
    uiLabel: "Region",
    uiPlaceholder: "us-chicago-1",
    uiHelpText: "Optional OCI Generative AI region override.",
  },
  genAiLlmModelId: {
    kind: "string",
    defaultValue: "",
    uiLabel: "LLM Model Name",
    uiPlaceholder: "meta.llama-3.1-70b-instruct,cohere.command-r-plus",
    uiHelpText: "Comma-separated. Chat dropdown shows all models; SQL Assistant always uses the first.",
  },
  genAiEmbeddingModelId: {
    kind: "string",
    defaultValue: "",
    uiLabel: "Embedding Model Name",
    uiPlaceholder: "cohere.embed-english-v3.0",
    uiHelpText: "Optional embedding model used for OCI Generative AI embedding requests.",
  },
  systemPrompt: {
    kind: "textarea",
    defaultValue: "",
    uiLabel: "System Prompt",
    uiPlaceholder: "You are a helpful OCI cloud assistant. Answer concisely and accurately.",
    uiHelpText: "This text is prepended to every chat session as initial instructions for the model. Leave empty to use the model's default behavior.",
    textareaRows: 6,
  },
} satisfies Record<GenAiTextFieldKey, SettingsSchemaFieldSpec>

const GENAI_TEXT_FIELD_CARDS = [
  {
    id: "ociGenerativeAi",
    title: "OCI Generative AI",
    fields: ["genAiRegion", "genAiLlmModelId", "genAiEmbeddingModelId"],
  },
  {
    id: "systemPrompt",
    title: "System Prompt",
    fields: ["systemPrompt"],
  },
] satisfies ReadonlyArray<SettingsSchemaCard<GenAiTextFieldKey>>

const API_CONFIG_FIELD_SPECS = {
  region: {
    kind: "string",
    defaultValue: "",
    uiLabel: "Regions",
    uiPlaceholder: "us-phoenix-1,us-chicago-1",
    uiHelpText: "Region is saved per profile. Use commas for multiple regions.",
  },
  tenancyOcid: {
    kind: "string",
    defaultValue: "",
    uiLabel: "Tenancy OCID",
    uiPlaceholder: "ocid1.tenancy...",
  },
  userOcid: {
    kind: "string",
    defaultValue: "",
    uiLabel: "User OCID",
    uiPlaceholder: "ocid1.user...",
  },
  fingerprint: {
    kind: "string",
    defaultValue: "",
    uiLabel: "Fingerprint",
    uiPlaceholder: "aa:bb:cc:...",
  },
  uploadKeyFile: {
    kind: "fileUpload",
    defaultValue: null,
    uiLabel: "Upload Key File",
    uiHelpText: "Upload a PEM, KEY, or TXT file to populate the private key field automatically.",
    uiFileAccept: ".pem,.key,.txt",
  },
  privateKey: {
    kind: "textarea",
    defaultValue: "",
    uiLabel: "Private Key",
    uiPlaceholder: "-----BEGIN PRIVATE KEY-----",
    uiHelpText: "Paste the PEM-formatted private key for this OCI profile, or upload a key file above.",
    textareaRows: 10,
  },
  privateKeyPassphrase: {
    kind: "string",
    defaultValue: "",
    uiInputType: "password",
    uiLabel: "Private Key Passphrase",
  },
} satisfies Record<ApiConfigFieldKey, SettingsSchemaFieldSpec>

const API_CONFIG_FIELDS = [
  "region",
  "tenancyOcid",
  "userOcid",
  "fingerprint",
  "uploadKeyFile",
  "privateKey",
  "privateKeyPassphrase",
] satisfies ReadonlyArray<ApiConfigFieldKey>

export const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; description: string; icon: React.ReactNode }> = [
  { id: "api-config", label: "Profiles", description: "Manage OCI profiles and API key credentials.", icon: <Settings2 size={16} /> },
  { id: "profiles", label: "Compartments", description: "Map feature scopes and saved OCI compartments.", icon: <Users size={16} /> },
  { id: "runtime", label: runtimeSettingsUiSchema.tab.label, description: runtimeSettingsUiSchema.tab.description, icon: renderSettingsSchemaIcon(runtimeSettingsUiSchema.tab.icon, 16) },
  { id: "terminal", label: "Terminal", description: "Tune shell execution and SSH defaults.", icon: <Terminal size={16} /> },
  { id: "genai", label: "Generative AI", description: "Configure GenAI regions, models, and prompt behavior.", icon: <Bot size={16} /> },
  { id: "mcp-servers", label: "MCP Servers", description: "MCP server registry and preview management.", icon: <Plug size={16} /> },
  { id: "agent-skills", label: "Agent Skills", description: "OpenClaw-style skill discovery plus agent permissions.", icon: <Wand2 size={16} /> },
  { id: "oca-proxy", label: "OCA Proxy", description: "Local OpenAI-compatible API backed by Oracle Code Assist.", icon: <Server size={16} /> },
  { id: "about", label: "About", description: "View extension package metadata.", icon: <Info size={16} /> },
]

const EMPTY_SETTINGS: SettingsState = {
  activeProfile: "DEFAULT",
  agentMode: "chat",
  region: "",
  compartmentId: "",
  computeCompartmentIds: [],
  chatCompartmentId: "",
  adbCompartmentIds: [],
  dbSystemCompartmentIds: [],
  vcnCompartmentIds: [],
  bastionCompartmentIds: [],
  objectStorageCompartmentIds: [],
  genAiRegion: "",
  genAiLlmModelId: "",
  genAiEmbeddingModelId: "",
  tenancyOcid: "",
  userOcid: "",
  fingerprint: "",
  privateKey: "",
  privateKeyPassphrase: "",
  systemPrompt: "",


  shellIntegrationTimeoutSec: runtimeSettingDefaults.shellIntegrationTimeoutSec,
  chatMaxTokens: runtimeSettingDefaults.chatMaxTokens,
  chatTemperature: runtimeSettingDefaults.chatTemperature,
  chatTopP: runtimeSettingDefaults.chatTopP,
  mcpFetchAutoPaginationMaxHops: runtimeSettingDefaults.mcpFetchAutoPaginationMaxHops,
  mcpFetchAutoPaginationMaxTotalChars: runtimeSettingDefaults.mcpFetchAutoPaginationMaxTotalChars,

  authMode: "api-key",
  savedCompartments: [],
  profilesConfig: [],
  extensionVersion: "",
  extensionDescription: "",
}

function getMissingApiKeyFields(s: Pick<SettingsState, "tenancyOcid" | "userOcid" | "fingerprint" | "privateKey">): string[] {
  const missing: string[] = []
  if (!s.tenancyOcid.trim()) missing.push("Tenancy OCID")
  if (!s.userOcid.trim()) missing.push("User OCID")
  if (!s.fingerprint.trim()) missing.push("Fingerprint")
  if (!s.privateKey.trim()) missing.push("Private Key")
  return missing
}

export default function SettingsView({ activeTab: controlledActiveTab, onDone, showDone = true }: SettingsViewProps) {
  const [settings, setSettings] = useState<SettingsState>(EMPTY_SETTINGS)
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS)
  const [sshConfig, setSshConfig] = useState<SshConfig>(loadSshConfig)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [editingProfileName, setEditingProfileName] = useState<string | null>(null)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const fetchIdRef = useRef(0)
  const editingProfileRef = useRef<string | null>(null)
  const refreshTimerRef = useRef<number | null>(null)
  const activeTab = controlledActiveTab ?? "api-config"
  const activeTabLabel = SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label ?? "None"
  const activeTabDescription = SETTINGS_TABS.find((tab) => tab.id === activeTab)?.description ?? ""

  const updateEditingProfile = useCallback((profileName: string | null) => {
    editingProfileRef.current = profileName
    setEditingProfileName(profileName)
  }, [])

  const resolveEditingProfile = useCallback((state: SettingsState, preferred?: string | null) => {
    const profiles = state.profilesConfig || []
    if (preferred && profiles.some((profile) => profile.name === preferred)) {
      return preferred
    }
    if (state.activeProfile.trim() && profiles.some((profile) => profile.name === state.activeProfile)) {
      return state.activeProfile.trim()
    }
    return profiles[0]?.name?.trim() || state.activeProfile.trim() || "DEFAULT"
  }, [])

  const applyEditingProfileSecrets = useCallback(async (state: SettingsState, profileName: string) => {
    if (!profileName || profileName === state.activeProfile.trim()) {
      return state
    }
    try {
      const secrets = await StateServiceClient.getProfileSecrets(profileName)
      return {
        ...state,
        region: secrets.region,
        tenancyOcid: secrets.tenancyOcid,
        userOcid: secrets.userOcid,
        fingerprint: secrets.fingerprint,
        privateKey: secrets.privateKey,
        privateKeyPassphrase: secrets.privateKeyPassphrase,
        authMode: secrets.authMode,
      }
    } catch (error) {
      console.error("Failed to load profile secrets:", error)
      return state
    }
  }, [])

  const refreshSettings = useCallback(async () => {
    const fetchId = ++fetchIdRef.current
    try {
      const [state, nextAgentSettings] = await Promise.all([
        StateServiceClient.getSettings(),
        AgentServiceClient.getSettings().catch(() => DEFAULT_AGENT_SETTINGS),
      ])
      const nextEditingProfile = resolveEditingProfile(state, editingProfileRef.current)
      const hydratedState = await applyEditingProfileSecrets(
        { ...state, agentMode: nextAgentSettings.mode },
        nextEditingProfile,
      )
      if (fetchId === fetchIdRef.current) {
        setSettings(hydratedState)
        setAgentSettings(nextAgentSettings)
        updateEditingProfile(nextEditingProfile)
        setLoaded(true)
      }
    } catch (error) {
      console.error("Failed to load settings:", error)
      if (fetchId === fetchIdRef.current) {
        setLoaded(true)
      }
    }
  }, [applyEditingProfileSecrets, resolveEditingProfile, updateEditingProfile])

  const scheduleRefreshSettings = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void refreshSettings()
    }, 200)
  }, [refreshSettings])

  // Load current settings.
  useEffect(() => {
    void refreshSettings()

    const unsubscribe = StateServiceClient.subscribeToState({
      onResponse: () => {
        scheduleRefreshSettings()
      },
      onError: (error) => console.error("State subscription error:", error),
      onComplete: () => { },
    })

    return () => {
      unsubscribe()
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [refreshSettings, scheduleRefreshSettings])

  const updateField = useCallback<UpdateFieldFn>((field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await Promise.all([
        StateServiceClient.saveSettings({
          ...settings,
          agentMode: agentSettings.mode,
          editingProfile: resolveEditingProfile(settings, editingProfileRef.current),
        }),
        AgentServiceClient.saveSettings(agentSettings),
      ])
    } catch (error) {
      console.error("Failed to save settings:", error)
    } finally {
      setSaving(false)
    }
  }, [agentSettings, resolveEditingProfile, settings])

  const handleGuardedAction = useCallback(async () => {
    if (!guardrail) {
      return
    }
    try {
      await guardrail.onConfirm()
      setGuardrail(null)
    } catch (error) {
      console.error("Failed to execute guarded settings action:", error)
      setGuardrail(null)
    }
  }, [guardrail])

  const handleFileUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const content = await file.text()
      updateField("privateKey", content)
    },
    [updateField],
  )

  useEffect(() => {
    saveSshConfig(sshConfig)
  }, [sshConfig])

  if (!loaded) {
    return (
      <div className="flex h-full min-h-0 flex-col p-4">
        <WorkbenchLoadingState label="Loading settings..." className="h-full" />
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
          <div className="flex min-w-0 items-center gap-2">
            <Settings2 size={14} className="text-[var(--vscode-icon-foreground)]" />
            <div className="flex min-w-0 flex-col">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">Settings</span>
              <span className="mt-0.5 text-[10px] text-description uppercase tracking-wider">{activeTabLabel}</span>
              {activeTabDescription && <span className="mt-1 text-[11px] text-description">{activeTabDescription}</span>}
            </div>
          </div>
          <WorkbenchInlineActionCluster className="shrink-0">
            {saving && (
              <span className="inline-flex items-center gap-1 text-[11px] text-description">
                <LoaderCircle size={12} className="animate-spin" />
                Saving...
              </span>
            )}
            {showDone && onDone && (
              <WorkbenchActionButton variant="secondary" onClick={onDone}>
                Close Settings
              </WorkbenchActionButton>
            )}
          </WorkbenchInlineActionCluster>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4">
            <div className="flex w-full flex-col gap-4">
              {activeTab === "api-config" && (
                <ApiConfigTab
                  editingProfile={editingProfileName}
                  setEditingProfile={updateEditingProfile}
                  settings={settings}
                  setSettings={setSettings}
                  updateField={updateField}
                  handleSave={handleSave}
                  handleFileUpload={handleFileUpload}
                  saving={saving}
                  onRequestGuardrail={setGuardrail}
                />
              )}
              {activeTab === "profiles" && (
                <ProfilesCompartmentsView />
              )}
              {activeTab === "genai" && (
                <GenAiTab
                  settings={settings}
                  updateField={updateField}
                  handleSave={handleSave}
                  saving={saving}
                />
              )}
              {activeTab === "runtime" && (
                <RuntimeTab
                  settings={settings}
                  agentSettings={agentSettings}
                  updateAgentSettings={setAgentSettings}
                  updateField={updateField}
                  handleSave={handleSave}
                  saving={saving}
                />
              )}
              {activeTab === "terminal" && (
                <TerminalTab
                  settings={settings}
                  sshConfig={sshConfig}
                  setSshConfig={setSshConfig}
                  updateField={updateField}
                  handleSave={handleSave}
                  saving={saving}
                />
              )}
              {activeTab === "mcp-servers" && <McpServersTab />}
              {activeTab === "agent-skills" && <AgentSkillsTab />}
              {activeTab === "oca-proxy" && <OcaProxyTab />}
              {activeTab === "about" && <AboutTab settings={settings} />}
            </div>
          </div>
        </div>
      </div>
      <GuardrailDialog
        open={guardrail !== null}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details ?? []}
        tone={guardrail?.tone}
        onCancel={() => setGuardrail(null)}
        onConfirm={() => void handleGuardedAction()}
      />
    </>
  )
}

function validateSettings(s: SettingsState, editingProfile: string): string[] {
  const errors: string[] = []
  if (splitModelNames(s.genAiLlmModelId).length === 0) {
    errors.push("LLM Model Name is required for AI chat")
  }
  if (!editingProfile.trim()) {
    errors.push("Profile Name is required for API key auth")
  }
  const missingApiKeyFields = getMissingApiKeyFields(s)
  if (missingApiKeyFields.length > 0) {
    errors.push(`Missing API key fields: ${missingApiKeyFields.join(", ")}`)
  }
  return errors
}

function splitModelNames(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function ApiConfigTab({
  editingProfile,
  setEditingProfile,
  settings,
  setSettings,
  updateField,
  handleSave,
  handleFileUpload,
  saving,
  onRequestGuardrail,
}: {
  editingProfile: string | null
  setEditingProfile: (profileName: string | null) => void
  settings: SettingsState
  setSettings: React.Dispatch<React.SetStateAction<SettingsState>>
  updateField: UpdateFieldFn
  handleSave: () => void
  handleFileUpload: (e: ChangeEvent<HTMLInputElement>) => void
  saving: boolean
  onRequestGuardrail: (value: WorkbenchGuardrailState) => void
}) {
  const [newProfileName, setNewProfileName] = useState("")
  const [addingProfile, setAddingProfile] = useState(false)
  const [deletingProfile, setDeletingProfile] = useState<string | null>(null)
  const profiles = settings.profilesConfig || []
  const runtimeProfile = settings.activeProfile.trim() || "DEFAULT"
  const effectiveSelectedProfile = editingProfile && profiles.some((profile) => profile.name === editingProfile)
    ? editingProfile
    : profiles.find((profile) => profile.name === runtimeProfile)?.name || profiles[0]?.name || runtimeProfile
  const validationErrors = validateSettings(settings, effectiveSelectedProfile)

  const loadProfileSecrets = (profileName: string) => {
    setEditingProfile(profileName)
    StateServiceClient.getProfileSecrets(profileName)
      .then((secrets) => {
        setSettings((prev) => ({
          ...prev,
          region: secrets.region,
          tenancyOcid: secrets.tenancyOcid,
          userOcid: secrets.userOcid,
          fingerprint: secrets.fingerprint,
          privateKey: secrets.privateKey,
          privateKeyPassphrase: secrets.privateKeyPassphrase,
          authMode: secrets.authMode,
        }))
      })
      .catch((err) => console.error("Failed to load profile secrets:", err))
  }

  const addProfile = async () => {
    const name = newProfileName.trim()
    if (!name || profiles.some(p => p.name === name)) return
    setAddingProfile(true)
    const updatedProfiles = [...profiles, { name, compartments: [] }]
    // Only add profile to the list, don't switch to it yet.
    // User should manually select it to edit.
    // New profiles may not have API key credentials in SecretStorage yet.
    const updatedSettings = {
      ...settings,
      profilesConfig: updatedProfiles,
    }
    setSettings(updatedSettings)
    setNewProfileName("")
    try {
      await StateServiceClient.saveSettings({
        ...updatedSettings,
        editingProfile: effectiveSelectedProfile,
        suppressNotification: true,
      })
    } catch (error) {
      console.error("Failed to save profile:", error)
    } finally {
      setAddingProfile(false)
    }
  }

  const deleteProfile = async (name: string) => {
    setDeletingProfile(name)
    const updatedProfiles = profiles.filter(p => p.name !== name)
    const nextProfile = updatedProfiles.length > 0 ? updatedProfiles[0].name : "DEFAULT"
    const updatedSettings = { ...settings, profilesConfig: updatedProfiles }
    const needsEditingProfileSwitch = effectiveSelectedProfile === name
    if (settings.activeProfile === name) {
      updatedSettings.activeProfile = nextProfile
    }
    setSettings(updatedSettings)
    try {
      await StateServiceClient.deleteProfile(name)
      if (needsEditingProfileSwitch) {
        setEditingProfile(nextProfile)
        loadProfileSecrets(nextProfile)
      }
    } catch (error) {
      console.error("Failed to delete profile:", error)
    } finally {
      setDeletingProfile(null)
    }
  }

  const requestDeleteProfile = (name: string) => {
    const profile = profiles.find((item) => item.name === name)
    onRequestGuardrail(createDeleteResourceGuardrail({
      resourceKind: "oci-profile",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Profile",
        resourceName: name,
        extras: [
          { label: "Compartments", value: String(profile?.compartments.length ?? 0) },
          { label: "Role", value: settings.activeProfile === name ? "Active runtime profile" : "Saved profile" },
        ],
      }),
      onConfirm: () => deleteProfile(name),
    }))
  }

  const apiConfigSchemaValues: ApiConfigSchemaValues = {
    region: settings.region,
    tenancyOcid: settings.tenancyOcid,
    userOcid: settings.userOcid,
    fingerprint: settings.fingerprint,
    uploadKeyFile: "",
    privateKey: settings.privateKey,
    privateKeyPassphrase: settings.privateKeyPassphrase,
  }
  const handleApiConfigKeyFileSelect = async (file: File | undefined) => {
    if (!file) {
      return
    }
    const content = await file.text()
    updateField("privateKey", content)
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Settings2 size={14} />
        Profiles
      </h3>
      <p className="-mt-2 text-xs text-description">These values are used for OCI API calls and model inference.</p>

      {validationErrors.length > 0 && (
        <InlineNotice tone="warning" title="Configuration incomplete">
          <div className="flex flex-col gap-1">
            {validationErrors.map((err) => (
              <span key={err}>• {err}</span>
            ))}
          </div>
        </InlineNotice>
      )}

      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-description">OCI Access</h4>
        <StatusBadge label="API Key Auth" tone="success" className="cursor-help" title="Using API Key from SecretStorage" />
      </div>
      <p className="-mt-1 text-xs text-description">
        All OCI requests use API Key credentials from SecretStorage. The OCI config file is not used.
      </p>
      <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,black_6%)] px-3 py-2">
        <p className="text-[11px] text-description">
          Runtime auth profile: <span className="font-medium text-[var(--vscode-foreground)]">{runtimeProfile}</span>
        </p>
        <p className="mt-1 text-[11px] text-description">
          Profile editing scope on this page: <span className="font-medium text-[var(--vscode-foreground)]">{effectiveSelectedProfile}</span>
        </p>
        {runtimeProfile !== effectiveSelectedProfile && (
          <p className="mt-1 text-[11px] text-warning">
            Saving here updates SecretStorage and region for "{effectiveSelectedProfile}" only. OCI requests still use "{runtimeProfile}" until you run "Switch Profile".
          </p>
        )}
      </div>

      {/* Profile Management */}
      <Card title="Profile Editing Scope">
        <div className="flex flex-col gap-1">
          <label htmlFor="profile" className="inline-flex items-center gap-1 text-xs text-description font-medium">
            <ChevronDown size={12} className="shrink-0" />
            Select Profile to Edit
          </label>
          <div className="flex flex-col gap-2">
            {profiles.length > 0 ? (
              profiles.map(p => (
                <div key={p.name} className={clsx(
                  "flex items-center justify-between gap-2 rounded-[2px] border px-2 py-1.5 transition-colors",
                  effectiveSelectedProfile === p.name
                    ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)]"
                )}>
                  <button
                    className="flex-1 text-left text-xs font-medium"
                    onClick={() => loadProfileSecrets(p.name)}
                  >
                    {p.name}
                    {effectiveSelectedProfile === p.name && (
                      <span className="ml-2 text-[10px] text-description">(Editing)</span>
                    )}
                  </button>
                  <WorkbenchIconDestructiveButton
                    onClick={() => requestDeleteProfile(p.name)}
                    disabled={deletingProfile === p.name}
                    title={`Delete profile "${p.name}"`}
                    icon={<Trash2 size={12} />}
                    busy={deletingProfile === p.name}
                    className="shrink-0"
                  />
                </div>
              ))
            ) : (
              <div className="text-xs text-description px-2 py-1.5">No profiles configured. Add one below.</div>
            )}
          </div>
          <p className="text-[10px] text-description mt-1">Choose which profile to edit on this page. This does not change the global active profile.</p>
        </div>

        {/* Add Profile */}
        <WorkbenchCompactActionCluster className="mt-2 border-t border-border-panel pt-3">
          <input
            placeholder="New Profile Name..."
            value={newProfileName}
            onChange={e => setNewProfileName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addProfile()}
            className="flex-1 rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none focus:border-border"
          />
          <WorkbenchActionButton variant="secondary" onClick={addProfile} disabled={addingProfile || !newProfileName.trim()}>
            {addingProfile ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Plus size={12} className="mr-1" />}
            {addingProfile ? "Adding..." : "Add"}
          </WorkbenchActionButton>
        </WorkbenchCompactActionCluster>
      </Card>

      <Card title="API Key (SecretStorage)">
        <p className="-mt-1 text-xs text-description">
          Fill all four required fields below. Requests will fail until SecretStorage has a complete API key for this profile.
        </p>
        {renderSettingsSchemaFields<ApiConfigSchemaValues, ApiConfigFieldKey>(
          API_CONFIG_FIELDS,
          API_CONFIG_FIELD_SPECS,
          apiConfigSchemaValues,
          updateField as ApiConfigUpdateFieldFn,
          {
            fileUploadHandlers: {
              uploadKeyFile: handleApiConfigKeyFileSelect,
            },
          },
        )}
      </Card>

      <WorkbenchInlineActionCluster>
        <WorkbenchActionButton onClick={handleSave} disabled={saving} className="self-start px-4">
          <Save size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save Settings"}
        </WorkbenchActionButton>
      </WorkbenchInlineActionCluster>
    </div>
  )
}


function GenAiTab({
  settings,
  updateField,
  handleSave,
  saving,
}: {
  settings: SettingsState
  updateField: UpdateFieldFn
  handleSave: () => void
  saving: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Bot size={14} />
        Generative AI
      </h3>
      <p className="-mt-2 text-xs text-description">Configure models and region for OCI Generative AI features.</p>

      {renderSettingsSchemaCards<SettingsState, GenAiTextFieldKey>(
        GENAI_TEXT_FIELD_CARDS,
        GENAI_TEXT_FIELD_SPECS,
        settings,
        updateField as GenAiTextUpdateFieldFn,
      )}

      {renderSettingsSchemaCards<SettingsState, RuntimeSettingKey>(
        runtimeSettingsUiSchema.sections.genai.cards,
        runtimeSettingSpecs,
        settings,
        updateField as RuntimeUpdateFieldFn,
      )}

      <WorkbenchInlineActionCluster>
        <WorkbenchActionButton onClick={handleSave} disabled={saving} className="self-start px-4">
          <Save size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save Settings"}
        </WorkbenchActionButton>
      </WorkbenchInlineActionCluster>
    </div>
  )
}

function RuntimeTab({
  settings,
  agentSettings,
  updateAgentSettings,
  updateField,
  handleSave,
  saving,
}: {
  settings: SettingsState
  agentSettings: AgentSettings
  updateAgentSettings: Dispatch<SetStateAction<AgentSettings>>
  updateField: UpdateFieldFn
  handleSave: () => void
  saving: boolean
}) {
  const isAgent = agentSettings.mode === "agent"

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        {renderSettingsSchemaIcon(runtimeSettingsUiSchema.page.icon, 14)}
        {runtimeSettingsUiSchema.page.title}
      </h3>
      <p className="-mt-2 text-xs text-description">{runtimeSettingsUiSchema.page.description}</p>

      <Card title="Agent Controls">
        <div className="rounded-md border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,var(--vscode-foreground)_3%)] px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-description">Chat Agent</span>
              <span className="text-xs text-description">Switch this on the Assistant page. Your last choice saves automatically.</span>
            </div>
            <span className="rounded-full border border-[var(--vscode-panel-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--vscode-foreground)]">
              {isAgent ? "Agent" : "Chat"}
            </span>
          </div>
        </div>

        {!isAgent && (
          <InlineNotice tone="info" size="sm">
            The controls below apply only in agent mode. Switch `Chat Agent` to `Agent` from the Assistant page to enable tool execution and auto-approval behavior.
          </InlineNotice>
        )}

        <div className="mt-3 flex flex-col gap-2">
          <Toggle
            checked={agentSettings.enabledTools.readFile}
            onChange={(checked) =>
              updateAgentSettings((prev) => ({
                ...prev,
                enabledTools: { ...prev.enabledTools, readFile: checked },
              }))
            }
            label="Read File"
            description="Read files from the current workspace. Also gates file listing and search helpers."
            disabled={!isAgent}
          />
          <Toggle
            checked={agentSettings.enabledTools.writeFile}
            onChange={(checked) =>
              updateAgentSettings((prev) => ({
                ...prev,
                enabledTools: { ...prev.enabledTools, writeFile: checked },
              }))
            }
            label="Write File"
            description="Create or edit files in the workspace."
            disabled={!isAgent}
          />
          <Toggle
            checked={agentSettings.enabledTools.executeCommand}
            onChange={(checked) =>
              updateAgentSettings((prev) => ({
                ...prev,
                enabledTools: { ...prev.enabledTools, executeCommand: checked },
              }))
            }
            label="Execute Command"
            description="Run terminal commands from the assistant."
            disabled={!isAgent}
          />
          <Toggle
            checked={agentSettings.enabledTools.webSearch}
            onChange={(checked) =>
              updateAgentSettings((prev) => ({
                ...prev,
                enabledTools: { ...prev.enabledTools, webSearch: checked },
              }))
            }
            label="Web Search"
            description="Allow the assistant to search the web and fetch URLs when needed."
            disabled={!isAgent}
          />
          <Toggle
            checked={agentSettings.enabledTools.browserAction}
            onChange={(checked) =>
              updateAgentSettings((prev) => ({
                ...prev,
                enabledTools: { ...prev.enabledTools, browserAction: checked },
              }))
            }
            label="Browser Action"
            description="Enable experimental browser automation for agent workflows."
            disabled={!isAgent}
          />
        </div>

        <div className="mt-4 border-t border-[var(--vscode-panel-border)] pt-4">
          <div className="text-xs font-medium text-foreground">Auto-Approval</div>
          <p className="mt-1 text-xs text-description">
            Auto-approved actions can run without another confirmation. Keep write and command permissions narrow unless you trust the current workflow.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            <Toggle
              checked={agentSettings.autoApproval.readFiles}
              onChange={(checked) =>
                updateAgentSettings((prev) => ({
                  ...prev,
                  autoApproval: { ...prev.autoApproval, readFiles: checked },
                }))
              }
              label="Read Operations"
              description="Auto-approve file reads."
              disabled={!isAgent}
            />
            <Toggle
              checked={agentSettings.autoApproval.writeFiles}
              onChange={(checked) =>
                updateAgentSettings((prev) => ({
                  ...prev,
                  autoApproval: { ...prev.autoApproval, writeFiles: checked },
                }))
              }
              label="Write Operations"
              description="Auto-approve file writes."
              disabled={!isAgent}
            />
            <Toggle
              checked={agentSettings.autoApproval.executeCommands}
              onChange={(checked) =>
                updateAgentSettings((prev) => ({
                  ...prev,
                  autoApproval: { ...prev.autoApproval, executeCommands: checked },
                }))
              }
              label="Command Execution"
              description="Auto-approve terminal commands."
              disabled={!isAgent}
            />
            <Toggle
              checked={agentSettings.autoApproval.webSearch}
              onChange={(checked) =>
                updateAgentSettings((prev) => ({
                  ...prev,
                  autoApproval: { ...prev.autoApproval, webSearch: checked },
                }))
              }
              label="Web Search"
              description="Auto-approve web lookups and URL fetches."
              disabled={!isAgent}
            />
            <Toggle
              checked={agentSettings.autoApproval.mcpTools}
              onChange={(checked) =>
                updateAgentSettings((prev) => ({
                  ...prev,
                  autoApproval: { ...prev.autoApproval, mcpTools: checked },
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
                value={String(agentSettings.maxAutoActions)}
                onChange={(event) => {
                  const value = parseInt(event.target.value, 10)
                  if (!Number.isNaN(value) && value >= 1 && value <= 100) {
                    updateAgentSettings((prev) => ({ ...prev, maxAutoActions: value }))
                  }
                }}
                disabled={!isAgent}
              />
              <span className="mt-1 block text-xs text-description">
                Maximum consecutive auto-approved actions before the assistant must stop and ask.
              </span>
            </div>
          </div>
        </div>
      </Card>

      {renderSettingsSchemaCards<SettingsState, RuntimeSettingKey>(
        runtimeSettingsUiSchema.sections.runtime.cards,
        runtimeSettingSpecs,
        settings,
        updateField,
      )}

      <WorkbenchInlineActionCluster>
        <WorkbenchActionButton onClick={handleSave} disabled={saving} className="self-start px-4">
          <Save size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save Settings"}
        </WorkbenchActionButton>
      </WorkbenchInlineActionCluster>
    </div>
  )
}

function TerminalTab({
  settings,
  sshConfig,
  setSshConfig,
  updateField,
  handleSave,
  saving,
}: {
  settings: SettingsState
  sshConfig: SshConfig
  setSshConfig: Dispatch<SetStateAction<SshConfig>>
  updateField: RuntimeUpdateFieldFn
  handleSave: () => void
  saving: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Terminal size={14} />
        Terminal
      </h3>
      <p className="-mt-2 text-xs text-description">Set terminal integration behavior used by command execution tasks.</p>

      {renderSettingsSchemaCards<SettingsState, RuntimeSettingKey>(
        runtimeSettingsUiSchema.sections.terminal.cards,
        runtimeSettingSpecs,
        settings,
        updateField,
      )}

      <Card title="Compute SSH Defaults">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-description">Username</span>
            <input
              type="text"
              value={sshConfig.username}
              onChange={(e) => setSshConfig((prev) => ({ ...prev, username: e.target.value }))}
              placeholder={DEFAULT_SSH_USERNAME}
              className="h-7 rounded-md border border-input-border bg-input-background px-2 text-xs outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-description">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={sshConfig.port}
              onChange={(e) => setSshConfig((prev) => ({ ...prev, port: clampPort(e.target.value) }))}
              className="h-7 rounded-md border border-input-border bg-input-background px-2 text-xs outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] text-description">Private Key Path (optional)</span>
            <input
              type="text"
              value={sshConfig.privateKeyPath}
              onChange={(e) => setSshConfig((prev) => ({ ...prev, privateKeyPath: e.target.value }))}
              placeholder="~/.ssh/id_rsa"
              className="h-7 rounded-md border border-input-border bg-input-background px-2 text-xs outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-description">Target Host</span>
            <select
              value={sshConfig.hostPreference}
              onChange={(e) => setSshConfig((prev) => ({ ...prev, hostPreference: e.target.value as HostPreference }))}
              className="h-7 rounded-md border border-input-border bg-input-background px-2 text-xs outline-none"
            >
              <option value="public">Public IP (fallback Private)</option>
              <option value="private">Private IP (fallback Public)</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pt-5 text-xs text-description">
            <input
              type="checkbox"
              checked={sshConfig.disableHostKeyChecking}
              onChange={(e) => setSshConfig((prev) => ({ ...prev, disableHostKeyChecking: e.target.checked }))}
              className="h-3.5 w-3.5 rounded border-input-border"
            />
            Disable host key checking
          </label>
        </div>
        <p className="text-xs text-description">Used by Compute view when launching SSH connection.</p>
      </Card>

      <WorkbenchInlineActionCluster>
        <WorkbenchActionButton onClick={handleSave} disabled={saving} className="self-start px-4">
          <Save size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save Settings"}
        </WorkbenchActionButton>
      </WorkbenchInlineActionCluster>
    </div>
  )
}

function AboutTab({ settings }: { settings: SettingsState }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Info size={14} />
        About
      </h3>
      <p className="-mt-2 text-xs text-description">Basic information about this extension package.</p>

      <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-description">Extension: </span>
            <span className="text-sm">oci-ai-unofficial</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-description">Version: </span>
            <span className="text-sm">{settings.extensionVersion}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-description">Description: </span>
            <span className="text-sm break-words">{settings.extensionDescription}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
