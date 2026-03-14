import { clsx } from "clsx"
import { Bot, ChevronDown, Info, Loader2, LoaderCircle, Plug, Plus, Save, Server, Settings2, Terminal, Trash2, Users, Wand2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react"
import { StateServiceClient } from "../../services/grpc-client"
import type { SettingsState } from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import ProfilesCompartmentsView from "../profiles/ProfilesCompartmentsView"
import { DEFAULT_SSH_USERNAME, clampPort, loadSshConfig, saveSshConfig, type HostPreference, type SshConfig } from "../../sshConfig"
import Card from "../ui/Card"
import Input from "../ui/Input"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
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


interface SettingsViewProps {
  activeTab?: SettingsTab
  onDone?: () => void
  showDone?: boolean
}

export type SettingsTab = "api-config" | "profiles" | "genai" | "terminal" | "mcp-servers" | "agent-skills" | "oca-proxy" | "about"
type UpdateFieldFn = <K extends keyof SettingsState>(field: K, value: SettingsState[K]) => void

export const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; description: string; icon: React.ReactNode }> = [
  { id: "api-config", label: "Profiles", description: "Manage OCI profiles and API key credentials.", icon: <Settings2 size={16} /> },
  { id: "profiles", label: "Compartments", description: "Map feature scopes and saved OCI compartments.", icon: <Users size={16} /> },
  { id: "terminal", label: "Terminal", description: "Tune shell execution and SSH defaults.", icon: <Terminal size={16} /> },
  { id: "genai", label: "Generative AI", description: "Configure GenAI regions, models, and prompt behavior.", icon: <Bot size={16} /> },
  { id: "mcp-servers", label: "MCP Servers", description: "Cline-style MCP registry and preview server management.", icon: <Plug size={16} /> },
  { id: "agent-skills", label: "Agent Skills", description: "OpenClaw-style skill discovery plus agent permissions.", icon: <Wand2 size={16} /> },
  { id: "oca-proxy", label: "OCA Proxy", description: "Local OpenAI-compatible API backed by Oracle Code Assist.", icon: <Server size={16} /> },
  { id: "about", label: "About", description: "View extension package metadata.", icon: <Info size={16} /> },
]

const EMPTY_SETTINGS: SettingsState = {
  activeProfile: "DEFAULT",
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


  shellIntegrationTimeoutSec: 4,
  chatMaxTokens: 16000,
  chatTemperature: 0,
  chatTopP: 1,

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
      const state = await StateServiceClient.getSettings()
      const nextEditingProfile = resolveEditingProfile(state, editingProfileRef.current)
      const hydratedState = await applyEditingProfileSecrets(state, nextEditingProfile)
      if (fetchId === fetchIdRef.current) {
        setSettings(hydratedState)
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
      await StateServiceClient.saveSettings({
        ...settings,
        editingProfile: resolveEditingProfile(settings, editingProfileRef.current),
      })
    } catch (error) {
      console.error("Failed to save settings:", error)
    } finally {
      setSaving(false)
    }
  }, [resolveEditingProfile, settings])

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
        <Input
          id="region"
          label="Regions"
          placeholder="us-phoenix-1,us-chicago-1"
          value={settings.region}
          onChange={(e) => updateField("region", e.target.value)}
        />
        <p className="-mt-1 text-[10px] text-description">Region is saved per profile. Use commas for multiple regions.</p>
        <Input
          id="tenancyOcid"
          label="Tenancy OCID"
          placeholder="ocid1.tenancy..."
          value={settings.tenancyOcid}
          onChange={(e) => updateField("tenancyOcid", e.target.value)}
        />
        <Input
          id="userOcid"
          label="User OCID"
          placeholder="ocid1.user..."
          value={settings.userOcid}
          onChange={(e) => updateField("userOcid", e.target.value)}
        />
        <Input
          id="fingerprint"
          label="Fingerprint"
          placeholder="aa:bb:cc:..."
          value={settings.fingerprint}
          onChange={(e) => updateField("fingerprint", e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label className="text-xs text-description">Upload Key File</label>
          <input
            type="file"
            accept=".pem,.key,.txt"
            onChange={handleFileUpload}
            className="text-xs text-description file:mr-2 file:rounded-md file:border file:border-input-border file:bg-button-secondary-background file:px-2.5 file:py-1.5 file:text-xs file:text-button-secondary-foreground"
          />
        </div>
        <Textarea
          id="privateKey"
          label="Private Key"
          placeholder="-----BEGIN PRIVATE KEY-----"
          value={settings.privateKey}
          onChange={(e) => updateField("privateKey", e.target.value)}
        />
        <Input
          id="privateKeyPassphrase"
          label="Private Key Passphrase"
          type="password"
          value={settings.privateKeyPassphrase}
          onChange={(e) => updateField("privateKeyPassphrase", e.target.value)}
        />
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

      <Card title="OCI Generative AI">
        <Input
          id="genAiRegion"
          label="Region"
          placeholder="us-chicago-1"
          value={settings.genAiRegion}
          onChange={(e) => updateField("genAiRegion", e.target.value)}
        />
        <Input
          id="genAiLlmModelId"
          label="LLM Model Name"
          placeholder="meta.llama-3.1-70b-instruct,cohere.command-r-plus"
          value={settings.genAiLlmModelId}
          onChange={(e) => updateField("genAiLlmModelId", e.target.value)}
        />
        <p className="-mt-1 text-xs text-description">
          Comma-separated. Chat dropdown shows all models; SQL Assistant always uses the first.
        </p>
        <Input
          id="genAiEmbeddingModelId"
          label="Embedding Model Name"
          placeholder="cohere.embed-english-v3.0"
          value={settings.genAiEmbeddingModelId}
          onChange={(e) => updateField("genAiEmbeddingModelId", e.target.value)}
        />
      </Card>

      <Card title="System Prompt">
        <Textarea
          id="systemPrompt"
          placeholder="You are a helpful OCI cloud assistant. Answer concisely and accurately."
          value={settings.systemPrompt}
          onChange={(e) => updateField("systemPrompt", e.target.value)}
        />
        <p className="-mt-1 text-xs text-description">
          This text is prepended to every chat session as initial instructions for the model.
          Leave empty to use the model's default behavior.
        </p>
      </Card>

      <Card title="LLM Parameters">
        <Input
          id="chatMaxTokens"
          label="Max Tokens"
          type="number"
          min={1}
          max={128000}
          value={settings.chatMaxTokens}
          onChange={(e) => updateField("chatMaxTokens", parseIntInput(e.target.value, 16000, 1, 128000))}
        />
        <Input
          id="chatTemperature"
          label="Temperature"
          type="number"
          step="0.1"
          min={0}
          max={2}
          value={settings.chatTemperature}
          onChange={(e) => updateField("chatTemperature", parseFloatInput(e.target.value, 0, 0, 2))}
        />
        <Input
          id="chatTopP"
          label="Top P"
          type="number"
          step="0.05"
          min={0}
          max={1}
          value={settings.chatTopP}
          onChange={(e) => updateField("chatTopP", parseFloatInput(e.target.value, 1, 0, 1))}
        />
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
  updateField: UpdateFieldFn
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

      <Card title="Command Execution">
        <Input
          id="shellIntegrationTimeoutSec"
          label="Shell Integration Timeout (seconds)"
          type="number"
          min={1}
          max={120}
          value={settings.shellIntegrationTimeoutSec}
          onChange={(e) => updateField("shellIntegrationTimeoutSec", parseIntInput(e.target.value, 4, 1, 120))}
        />
        <p className="-mt-1 text-xs text-description">
          How long command execution should wait for shell integration before timing out.
        </p>
      </Card>

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



function parseIntInput(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}

function parseFloatInput(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}
