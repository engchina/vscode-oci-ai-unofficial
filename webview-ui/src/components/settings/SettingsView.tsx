import { clsx } from "clsx"
import { BookmarkPlus, Bot, Info, LoaderCircle, Save, Settings2, Sliders, Terminal, Trash2, Wrench } from "lucide-react"
import { useCallback, useEffect, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react"
import { StateServiceClient } from "../../services/grpc-client"
import type { SavedCompartment, SettingsState } from "../../services/types"
import { DEFAULT_SSH_USERNAME, clampPort, loadSshConfig, saveSshConfig, type HostPreference, type SshConfig } from "../../sshConfig"
import Button from "../ui/Button"
import Card from "../ui/Card"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"
import Toggle from "../ui/Toggle"
import { Plus } from "lucide-react"

interface SettingsViewProps {
  onDone?: () => void
  showDone?: boolean
}

type SettingsTab = "api-config" | "genai" | "features" | "terminal" | "general" | "about"
type UpdateFieldFn = <K extends keyof SettingsState>(field: K, value: SettingsState[K]) => void

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "api-config", label: "API Configuration", icon: <Settings2 size={16} /> },
  { id: "genai", label: "Generative AI", icon: <Bot size={16} /> },
  { id: "features", label: "Features", icon: <Sliders size={16} /> },
  { id: "terminal", label: "Terminal", icon: <Terminal size={16} /> },
  { id: "general", label: "General", icon: <Wrench size={16} /> },
  { id: "about", label: "About", icon: <Info size={16} /> },
]

const EMPTY_SETTINGS: SettingsState = {
  activeProfile: "DEFAULT",
  profile: "",
  region: "",
  compartmentId: "",
  computeCompartmentIds: [],
  chatCompartmentId: "",
  adbCompartmentIds: [],
  genAiRegion: "",
  genAiLlmModelId: "",
  genAiEmbeddingModelId: "",
  tenancyOcid: "",
  userOcid: "",
  fingerprint: "",
  privateKey: "",
  privateKeyPassphrase: "",
  systemPrompt: "",

  nativeToolCall: true,
  parallelToolCalling: true,
  strictPlanMode: true,
  autoCompact: true,
  checkpoints: true,

  shellIntegrationTimeoutSec: 4,
  chatMaxTokens: 64000,
  chatTemperature: 0,
  chatTopP: 1,

  authMode: "config-file",
  savedCompartments: [],
  profilesConfig: [],
}

export default function SettingsView({ onDone, showDone = true }: SettingsViewProps) {
  const [settings, setSettings] = useState<SettingsState>(EMPTY_SETTINGS)
  const [sshConfig, setSshConfig] = useState<SshConfig>(loadSshConfig)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>("api-config")
  const activeTabLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? "None"
  const toggleTab = useCallback((tab: SettingsTab) => {
    setActiveTab(tab)
  }, [])

  // Load current settings.
  useEffect(() => {
    StateServiceClient.getSettings()
      .then((state) => {
        setSettings(state)
        setLoaded(true)
      })
      .catch((error) => {
        console.error("Failed to load settings:", error)
        setLoaded(true)
      })
  }, [])

  const updateField = useCallback<UpdateFieldFn>((field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await StateServiceClient.saveSettings(settings)
    } catch (error) {
      console.error("Failed to save settings:", error)
    } finally {
      setSaving(false)
    }
  }, [settings])

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
      <div className="flex h-full items-center justify-center px-6">
        <span className="text-sm text-description">Loading settings...</span>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border-panel px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-panel bg-list-background-hover">
            <Settings2 size={14} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">OCI Settings</span>
            <span className="text-xs text-description">Manage OCI profile, model, and extension preferences.</span>
            <span className="mt-1 text-[11px] uppercase tracking-wider text-description">Current section: {activeTabLabel}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saving && (
            <span className="inline-flex items-center gap-1 text-xs text-description">
              <LoaderCircle size={12} className="animate-spin" />
              Saving...
            </span>
          )}
          {showDone && onDone && (
            <Button variant="secondary" size="sm" onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-14 shrink-0 flex-col gap-1 border-r border-border-panel bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_70%,transparent)] p-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => toggleTab(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              className={clsx(
                "flex h-9 w-full items-center justify-center rounded-md transition-colors",
                activeTab === tab.id
                  ? "bg-list-background-hover text-foreground"
                  : "text-description hover:bg-list-background-hover hover:text-foreground",
              )}
            >
              {tab.icon}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4">
          <div className="flex w-full flex-col gap-4">
            {activeTab === "api-config" && (
              <ApiConfigTab
                settings={settings}
                setSettings={setSettings}
                updateField={updateField}
                handleSave={handleSave}
                handleFileUpload={handleFileUpload}
                saving={saving}
              />
            )}
            {activeTab === "genai" && (
              <GenAiTab
                settings={settings}
                updateField={updateField}
                handleSave={handleSave}
                saving={saving}
              />
            )}
            {activeTab === "features" && (
              <FeaturesTab
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
            {activeTab === "general" && <GeneralTab settings={settings} />}
            {activeTab === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function validateSettings(s: SettingsState): string[] {
  const errors: string[] = []
  if (!s.compartmentId.trim()) errors.push("Compartment ID is required")
  if (splitModelNames(s.genAiLlmModelId).length === 0) {
    errors.push("LLM Model Name is required for AI chat")
  }
  if (s.authMode === "config-file" && !s.profile.trim()) errors.push("Profile Name is required for config file auth")
  return errors
}

function splitModelNames(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function ApiConfigTab({
  settings,
  setSettings,
  updateField,
  handleSave,
  handleFileUpload,
  saving,
}: {
  settings: SettingsState
  setSettings: (s: SettingsState) => void
  updateField: UpdateFieldFn
  handleSave: () => void
  handleFileUpload: (e: ChangeEvent<HTMLInputElement>) => void
  saving: boolean
}) {
  const validationErrors = validateSettings(settings)

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Settings2 size={14} />
        API Configuration
      </h3>
      <p className="-mt-2 text-xs text-description">These values are used for OCI API calls and model inference.</p>

      {validationErrors.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,yellow_12%)] px-3 py-2.5">
          <span className="text-xs font-medium text-warning">Configuration incomplete:</span>
          {validationErrors.map((err) => (
            <span key={err} className="text-xs text-warning">• {err}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-description">OCI Access</h4>
        <span
          className={clsx(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
            settings.authMode === "api-key"
              ? "border-success/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,green_20%)] text-success"
              : "border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] text-description",
          )}
          title={
            settings.authMode === "api-key"
              ? "Using API Key from SecretStorage"
              : "Using OCI config file (~/.oci/config)"
          }
        >
          {settings.authMode === "api-key" ? "API Key Auth" : "Config File Auth"}
        </span>
      </div>
      <p className="-mt-1 text-xs text-description">
        {settings.authMode === "api-key"
          ? "All required API Key fields are set. Requests will use SecretStorage credentials."
          : "Fill in Tenancy OCID, User OCID, Fingerprint, and Private Key below to switch to API Key auth."}
      </p>

      <ProfileConfigEditor settings={settings} updateField={updateField} />

      <Card title="Legacy Profile & Context">
        <p className="text-[11px] text-description -mt-1 mb-2">Used as fallback if specific features are not configured.</p>
        <Input
          id="profile"
          label="Profile Name"
          placeholder="DEFAULT"
          value={settings.profile}
          onChange={(e) => updateField("profile", e.target.value)}
        />
        <Input
          id="region"
          label="Region"
          placeholder="us-phoenix-1"
          value={settings.region}
          onChange={(e) => updateField("region", e.target.value)}
        />
        <Input
          id="compartmentId"
          label="Compartment ID"
          placeholder="ocid1.compartment..."
          value={settings.compartmentId}
          onChange={(e) => updateField("compartmentId", e.target.value)}
        />
        <SavedCompartmentsSection
          savedCompartments={settings.savedCompartments}
          currentCompartmentId={settings.compartmentId}
          onSwitch={async (id) => {
            await StateServiceClient.switchCompartment(id)
            updateField("compartmentId", id)
          }}
          onRefresh={async () => {
            const fresh = await StateServiceClient.getSettings()
            setSettings(fresh)
          }}
        />
      </Card>

      <Card title="API Key (SecretStorage)">
        <p className="-mt-1 text-xs text-description">
          When all four fields below are filled, API Key auth takes priority over the OCI config file.
        </p>
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

      <Button onClick={handleSave} disabled={saving} className="self-start px-4">
        <Save size={14} className="mr-1.5" />
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  )
}

function ProfileConfigEditor({ settings, updateField }: { settings: SettingsState, updateField: UpdateFieldFn }) {
  const [newProfile, setNewProfile] = useState("")
  const [newCompId, setNewCompId] = useState("")
  const [newCompName, setNewCompName] = useState("")
  const [editingProfile, setEditingProfile] = useState<string | null>(null)

  const profiles = settings.profilesConfig || []

  const addProfile = () => {
    if (!newProfile.trim() || profiles.some(p => p.name === newProfile.trim())) return
    const updated = [...profiles, { name: newProfile.trim(), compartments: [] }]
    updateField("profilesConfig", updated)
    if (!settings.activeProfile || settings.activeProfile === "DEFAULT") {
      updateField("activeProfile", newProfile.trim())
    }
    setNewProfile("")
  }

  const removeProfile = (name: string) => {
    const updated = profiles.filter(p => p.name !== name)
    updateField("profilesConfig", updated)
    if (settings.activeProfile === name) {
      updateField("activeProfile", updated.length > 0 ? updated[0].name : "DEFAULT")
    }
  }

  const addCompartment = (profileName: string) => {
    if (!newCompId.trim() || !newCompName.trim()) return
    const updated = profiles.map(p => {
      if (p.name === profileName) {
        if (p.compartments.some(c => c.id === newCompId.trim())) return p
        return { ...p, compartments: [...p.compartments, { id: newCompId.trim(), name: newCompName.trim() }] }
      }
      return p
    })
    updateField("profilesConfig", updated)
    setNewCompId("")
    setNewCompName("")
  }

  const removeCompartment = (profileName: string, compId: string) => {
    const updated = profiles.map(p => {
      if (p.name === profileName) {
        return { ...p, compartments: p.compartments.filter(c => c.id !== compId) }
      }
      return p
    })
    updateField("profilesConfig", updated)
  }

  return (
    <Card title="Profiles & Compartments">
      <div className="flex flex-col gap-3">
        {/* Global Active Profile Selector */}
        <div className="flex flex-col gap-1.5 pb-2 border-b border-border-panel">
          <label className="text-xs text-description font-medium">Global Active Profile</label>
          <select
            value={settings.activeProfile || "DEFAULT"}
            onChange={e => updateField("activeProfile", e.target.value)}
            className="w-full rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none focus:border-border"
          >
            {profiles.length > 0 ? (
              profiles.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))
            ) : (
              <option value="DEFAULT">DEFAULT</option>
            )}
            {/* Guarantee active profile is always in options */}
            {settings.activeProfile && settings.activeProfile !== "DEFAULT" && !profiles.some(p => p.name === settings.activeProfile) && (
              <option value={settings.activeProfile}>{settings.activeProfile} (Not configured)</option>
            )}
          </select>
          <p className="text-[10px] text-description">All feature compartments are fetched based on the global active profile.</p>
        </div>

        {/* Profile List */}
        <div className="flex flex-col gap-2">
          {profiles.map(p => (
            <div key={p.name} className="flex flex-col gap-2 rounded-md border border-border-panel p-2 bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,black_4%)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{p.name}</span>
                <button
                  onClick={() => removeProfile(p.name)}
                  className="rounded p-1 text-description hover:bg-list-background-hover hover:text-error transition-colors"
                  title="Remove Profile"
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {/* Compartments inside Profile */}
              <div className="flex flex-col pl-2 gap-1 border-l-2 border-border-panel">
                {p.compartments.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)]">
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs truncate">{c.name}</span>
                      <span className="text-[10px] text-description truncate" title={c.id}>{c.id}</span>
                    </div>
                    <button
                      onClick={() => removeCompartment(p.name, c.id)}
                      className="shrink-0 text-description hover:text-error"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}

                {editingProfile === p.name ? (
                  <div className="flex flex-col gap-1.5 mt-1 border-t border-border-panel pt-2">
                    <input
                      placeholder="Compartment Name (e.g. Prod)"
                      value={newCompName}
                      onChange={e => setNewCompName(e.target.value)}
                      className="rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none"
                    />
                    <input
                      placeholder="Compartment OCID"
                      value={newCompId}
                      onChange={e => setNewCompId(e.target.value)}
                      className="rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="secondary" onClick={() => setEditingProfile(null)}>Cancel</Button>
                      <Button size="sm" disabled={!newCompId.trim() || !newCompName.trim()} onClick={() => { addCompartment(p.name); setEditingProfile(null); }}>Add</Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditingProfile(p.name); setNewCompId(""); setNewCompName(""); }}
                    className="flex items-center gap-1.5 mt-1 px-2 py-1 text-xs text-description hover:text-foreground transition-colors w-fit"
                  >
                    <Plus size={12} /> Add Compartment
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Add Profile */}
          <div className="flex gap-2 mt-2">
            <input
              placeholder="New Profile Name..."
              value={newProfile}
              onChange={e => setNewProfile(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addProfile()}
              className="flex-1 rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none focus:border-border"
            />
            <Button size="sm" variant="secondary" onClick={addProfile} disabled={!newProfile.trim()}>Add Profile</Button>
          </div>
        </div>
      </div>
    </Card>
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
          Use commas to configure multiple models. Chat page dropdown will show them in order and default to the first.
        </p>
        <Input
          id="genAiEmbeddingModelId"
          label="Embedding Model Name"
          placeholder="cohere.embed-english-v3.0"
          value={settings.genAiEmbeddingModelId}
          onChange={(e) => updateField("genAiEmbeddingModelId", e.target.value)}
        />
      </Card>

      <Button onClick={handleSave} disabled={saving} className="self-start px-4">
        <Save size={14} className="mr-1.5" />
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  )
}

function FeaturesTab({
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
        <Sliders size={14} />
        Feature Settings
      </h3>
      <p className="-mt-2 text-xs text-description">Fine tune runtime behavior for the assistant and editor workflows.</p>

      <Card title="AI Behavior">
        <Textarea
          id="systemPrompt"
          label="System Prompt"
          placeholder="You are a helpful OCI cloud assistant. Answer concisely and accurately."
          value={settings.systemPrompt}
          onChange={(e) => updateField("systemPrompt", e.target.value)}
        />
        <p className="-mt-1 text-xs text-description">
          This text is prepended to every chat session as initial instructions for the model.
          Leave empty to use the model's default behavior.
        </p>
      </Card>

      <Card title="Chat Generation">
        <Input
          id="chatMaxTokens"
          label="Max Tokens"
          type="number"
          min={1}
          max={128000}
          value={settings.chatMaxTokens}
          onChange={(e) => updateField("chatMaxTokens", parseIntInput(e.target.value, 64000, 1, 128000))}
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

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-description">Agent</h4>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
          <Toggle
            label="Native Tool Call"
            description="Use native function calling when available"
            checked={settings.nativeToolCall}
            onChange={(checked) => updateField("nativeToolCall", checked)}
          />
          <Toggle
            label="Parallel Tool Calling"
            description="Execute multiple tool calls simultaneously"
            checked={settings.parallelToolCalling}
            onChange={(checked) => updateField("parallelToolCalling", checked)}
          />
          <Toggle
            label="Strict Plan Mode"
            description="Prevents file edits while in Plan mode"
            checked={settings.strictPlanMode}
            onChange={(checked) => updateField("strictPlanMode", checked)}
          />
          <Toggle
            label="Auto Compact"
            description="Automatically compress conversation history"
            checked={settings.autoCompact}
            onChange={(checked) => updateField("autoCompact", checked)}
          />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-description">Editor</h4>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
          <Toggle
            label="Checkpoints"
            description="Save progress at key points for easy rollback"
            checked={settings.checkpoints}
            onChange={(checked) => updateField("checkpoints", checked)}
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="self-start px-4">
        <Save size={14} className="mr-1.5" />
        {saving ? "Saving..." : "Save Settings"}
      </Button>
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
        Terminal Settings
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

      <Button onClick={handleSave} disabled={saving} className="self-start px-4">
        <Save size={14} className="mr-1.5" />
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  )
}

function GeneralTab({ settings }: { settings: SettingsState }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Wrench size={14} />
        General Settings
      </h3>
      <p className="-mt-2 text-xs text-description">Global extension preferences and behavior controls.</p>

      <div className="rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
        <div className="flex flex-col gap-2 text-xs text-description">
          <span>Native Tool Call: {settings.nativeToolCall ? "On" : "Off"}</span>
          <span>Parallel Tool Calling: {settings.parallelToolCalling ? "On" : "Off"}</span>
          <span>Strict Plan Mode: {settings.strictPlanMode ? "On" : "Off"}</span>
          <span>Auto Compact: {settings.autoCompact ? "On" : "Off"}</span>
          <span>Checkpoints: {settings.checkpoints ? "On" : "Off"}</span>
        </div>
      </div>
    </div>
  )
}

function AboutTab() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Info size={14} />
        About
      </h3>
      <p className="-mt-2 text-xs text-description">Basic information about this extension package.</p>

      <div className="rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-description">Extension: </span>
            <span className="text-sm">vscode-oci-ai-unofficial</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-description">Version: </span>
            <span className="text-sm">0.0.1</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-description">Description: </span>
            <span className="text-sm break-words">OCI development toolkit for VS Code, covering AI and broader OCI workflows.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SavedCompartmentsSection({
  savedCompartments,
  currentCompartmentId,
  onSwitch,
  onRefresh,
}: {
  savedCompartments: SavedCompartment[]
  currentCompartmentId: string
  onSwitch: (id: string) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [saveName, setSaveName] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)

  const handleSave = async () => {
    const name = saveName.trim()
    const id = currentCompartmentId.trim()
    if (!name || !id) return
    setSaving(true)
    try {
      await StateServiceClient.saveCompartment(name, id)
      setSaveName("")
      await onRefresh()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    try {
      await StateServiceClient.deleteCompartment(id)
      await onRefresh()
    } finally {
      setDeleting(null)
    }
  }

  const handleSwitch = async (id: string) => {
    setSwitching(id)
    try {
      await onSwitch(id)
      await onRefresh()
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <span className="text-xs font-medium text-description">Saved Compartments</span>
      {savedCompartments.length > 0 && (
        <div className="flex flex-col gap-1">
          {savedCompartments.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-md border border-border-panel px-2 py-1.5">
              <button
                onClick={() => handleSwitch(c.id)}
                title={c.id}
                disabled={switching === c.id}
                className={clsx(
                  "flex-1 truncate text-left text-xs disabled:opacity-50",
                  currentCompartmentId === c.id ? "font-semibold text-foreground" : "text-description hover:text-foreground",
                )}
              >
                {c.name}
                {switching === c.id ? (
                  <span className="ml-1 inline-flex align-middle text-description">
                    <LoaderCircle size={11} className="animate-spin" />
                  </span>
                ) : currentCompartmentId === c.id ? (
                  <span className="ml-1 text-success">✓</span>
                ) : null}
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                disabled={deleting === c.id}
                className="shrink-0 rounded p-0.5 text-description hover:text-error disabled:opacity-40"
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name for current compartment..."
          className="flex-1 rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs text-input-foreground outline-none placeholder:text-input-placeholder focus:border-border"
          onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
        />
        <button
          onClick={handleSave}
          disabled={saving || !saveName.trim() || !currentCompartmentId.trim()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border-panel px-2 py-1.5 text-xs text-description hover:text-foreground disabled:opacity-40"
          title="Save current compartment ID with this name"
        >
          <BookmarkPlus size={12} />
          Save
        </button>
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
