import { clsx } from "clsx"
import { Info, LoaderCircle, Save, Settings2, Sliders, Terminal, Wrench } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { StateServiceClient } from "../../services/grpc-client"
import type { SettingsState } from "../../services/types"
import Button from "../ui/Button"
import Card from "../ui/Card"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"
import Toggle from "../ui/Toggle"

interface SettingsViewProps {
  onDone?: () => void
  showDone?: boolean
}

type SettingsTab = "api-config" | "features" | "terminal" | "general" | "about"

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "api-config", label: "API Configuration", icon: <Settings2 size={16} /> },
  { id: "features", label: "Features", icon: <Sliders size={16} /> },
  { id: "terminal", label: "Terminal", icon: <Terminal size={16} /> },
  { id: "general", label: "General", icon: <Wrench size={16} /> },
  { id: "about", label: "About", icon: <Info size={16} /> },
]

const EMPTY_SETTINGS: SettingsState = {
  profile: "",
  region: "",
  compartmentId: "",
  genAiRegion: "",
  genAiLlmModelId: "",
  genAiEmbeddingModelId: "",
  tenancyOcid: "",
  userOcid: "",
  fingerprint: "",
  privateKey: "",
  privateKeyPassphrase: "",
}

export default function SettingsView({ onDone, showDone = true }: SettingsViewProps) {
  const [settings, setSettings] = useState<SettingsState>(EMPTY_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>("api-config")
  const activeTabLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? "None"
  const toggleTab = useCallback((tab: SettingsTab) => {
    setActiveTab(tab)
  }, [])

  // Load current settings
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

  const updateField = useCallback((field: keyof SettingsState, value: string) => {
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
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const content = await file.text()
      updateField("privateKey", content)
    },
    [updateField],
  )

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
                updateField={updateField}
                handleSave={handleSave}
                handleFileUpload={handleFileUpload}
                saving={saving}
              />
            )}
            {activeTab === "features" && <FeaturesTab />}
            {activeTab === "terminal" && <TerminalTab />}
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

function ApiConfigTab({
  settings,
  updateField,
  handleSave,
  handleFileUpload,
  saving,
}: {
  settings: SettingsState
  updateField: (field: keyof SettingsState, value: string) => void
  handleSave: () => void
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  saving: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Settings2 size={14} />
        API Configuration
      </h3>
      <p className="-mt-2 text-xs text-description">These values are used for OCI API calls and model inference.</p>

      <Card title="OCI Access (API Key + Context)">
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
          placeholder="meta.llama-3.1-70b-instruct"
          value={settings.genAiLlmModelId}
          onChange={(e) => updateField("genAiLlmModelId", e.target.value)}
        />
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

function FeaturesTab() {
  const [features, setFeatures] = useState({
    nativeToolCall: true,
    parallelToolCalling: true,
    strictPlanMode: true,
    autoCompact: true,
    checkpoints: true,
  })

  const toggle = (key: keyof typeof features) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Sliders size={14} />
        Feature Settings
      </h3>
      <p className="-mt-2 text-xs text-description">Fine tune runtime behavior for the assistant and editor workflows.</p>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-description">Agent</h4>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
          <Toggle
            label="Native Tool Call"
            description="Use native function calling when available"
            checked={features.nativeToolCall}
            onChange={() => toggle("nativeToolCall")}
          />
          <Toggle
            label="Parallel Tool Calling"
            description="Execute multiple tool calls simultaneously"
            checked={features.parallelToolCalling}
            onChange={() => toggle("parallelToolCalling")}
          />
          <Toggle
            label="Strict Plan Mode"
            description="Prevents file edits while in Plan mode"
            checked={features.strictPlanMode}
            onChange={() => toggle("strictPlanMode")}
          />
          <Toggle
            label="Auto Compact"
            description="Automatically compress conversation history"
            checked={features.autoCompact}
            onChange={() => toggle("autoCompact")}
          />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-description">Editor</h4>
        <div className="flex flex-col gap-2.5 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
          <Toggle
            label="Checkpoints"
            description="Save progress at key points for easy rollback"
            checked={features.checkpoints}
            onChange={() => toggle("checkpoints")}
          />
        </div>
      </div>
    </div>
  )
}

function TerminalTab() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Terminal size={14} />
        Terminal Settings
      </h3>
      <p className="-mt-2 text-xs text-description">Set terminal integration behavior used by command execution tasks.</p>

      <div className="flex flex-col gap-3 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Shell Integration Timeout (seconds)</span>
          <span className="text-xs text-description">
            Set how long to wait for shell to activate before executing commands.
          </span>
          <input
            type="number"
            defaultValue={4}
            min={1}
            max={30}
            className="mt-1 w-full max-w-[220px] rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-input-foreground outline-none focus:border-border"
          />
        </div>
      </div>
    </div>
  )
}

function GeneralTab() {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Wrench size={14} />
        General Settings
      </h3>
      <p className="-mt-2 text-xs text-description">Global extension preferences and behavior controls.</p>

      <div className="rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
        <p className="text-xs text-description">General preferences will appear here in future updates.</p>
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
