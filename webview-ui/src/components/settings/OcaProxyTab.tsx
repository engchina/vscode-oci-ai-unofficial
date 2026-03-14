import {
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  RefreshCw,
  Save,
  Server,
  Square,
  Triangle,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { OcaProxyServiceClient } from "../../services/grpc-client"
import type { OcaProxyStatus } from "../../services/types"
import Card from "../ui/Card"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
  WorkbenchIconActionButton,
  WorkbenchInlineActionCluster,
} from "../workbench/WorkbenchActionButtons"

const REASONING_EFFORT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
]
const FIXED_PROXY_PORT = "8669"
const AUTH_POLL_INTERVAL_MS = 3000
const AUTH_POLL_MAX_ATTEMPTS = 100

function parseProxyPortInput(value: string): number | null {
  const trimmed = value.trim()
  return trimmed === FIXED_PROXY_PORT ? Number(FIXED_PROXY_PORT) : null
}

export default function OcaProxyTab() {
  const [status, setStatus] = useState<OcaProxyStatus | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [loadingAuth, setLoadingAuth] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [togglingProxy, setTogglingProxy] = useState(false)
  const [generatingKey, setGeneratingKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local editable config state
  const [localModel, setLocalModel] = useState("")
  const [localReasoningEffort, setLocalReasoningEffort] = useState("none")
  const [localPortInput, setLocalPortInput] = useState(FIXED_PROXY_PORT)

  const copiedTimerRef = useRef<number | null>(null)
  const authPollRef = useRef<number | null>(null)

  const applyStatus = useCallback((s: OcaProxyStatus) => {
    setStatus(s)
    setLocalModel(s.model)
    setLocalReasoningEffort(s.reasoningEffort)
    setLocalPortInput(String(s.proxyPort))
    setModels(s.availableModels)
  }, [])

  const stopAuthPolling = useCallback(() => {
    if (authPollRef.current !== null) {
      window.clearInterval(authPollRef.current)
      authPollRef.current = null
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const s = await OcaProxyServiceClient.getOcaProxyStatus()
      applyStatus(s)
      setError(s.authError ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [applyStatus])

  useEffect(() => {
    setLoadingAuth(status?.authInProgress ?? false)
    if (!(status?.authInProgress ?? false)) {
      stopAuthPolling()
    }
  }, [status?.authInProgress, stopAuthPolling])

  useEffect(() => {
    void loadStatus()
    return () => {
      // Clean up polling on unmount
      stopAuthPolling()
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    }
  }, [loadStatus, stopAuthPolling])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data
      if (
        msg?.type === "grpc_response" &&
        msg?.grpc_response?.request_id === "__refresh__" &&
        msg?.grpc_response?.message?.refresh
      ) {
        void loadStatus()
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [loadStatus])

  const handleSignIn = useCallback(async () => {
    setLoadingAuth(true)
    setError(null)
    try {
      await OcaProxyServiceClient.startOcaAuth()
      const currentStatus = await OcaProxyServiceClient.getOcaProxyStatus()
      applyStatus(currentStatus)
      if (currentStatus.authError) {
        setError(currentStatus.authError)
      }
      if (!currentStatus.authInProgress) {
        setLoadingAuth(false)
        return
      }

      // Poll as a fallback in case the refresh signal is missed.
      let attempts = 0
      stopAuthPolling()
      authPollRef.current = window.setInterval(async () => {
        attempts++
        try {
          const s = await OcaProxyServiceClient.getOcaProxyStatus()
          applyStatus(s)
          if (s.authError) {
            setError(s.authError)
            stopAuthPolling()
            setLoadingAuth(false)
            return
          }
          if (s.isAuthenticated || !s.authInProgress) {
            stopAuthPolling()
            setLoadingAuth(false)
            return
          }
        } catch { /* ignore poll errors */ }
        if (attempts >= AUTH_POLL_MAX_ATTEMPTS) {
          stopAuthPolling()
          setLoadingAuth(false)
          setError("Sign-in timed out. Try again.")
        }
      }, AUTH_POLL_INTERVAL_MS)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      stopAuthPolling()
      setLoadingAuth(false)
    }
  }, [applyStatus, stopAuthPolling])

  const handleLogout = useCallback(async () => {
    setError(null)
    stopAuthPolling()
    setLoadingAuth(false)
    try {
      await OcaProxyServiceClient.logoutOca()
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [loadStatus, stopAuthPolling])

  const handleFetchModels = useCallback(async () => {
    setLoadingModels(true)
    setError(null)
    try {
      const res = await OcaProxyServiceClient.fetchOcaModels()
      setModels(res.models)
      setStatus((prev) => (prev ? { ...prev, availableModels: res.models } : prev))
      if (res.models.length > 0 && !localModel) {
        setLocalModel(res.models[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModels(false)
    }
  }, [localModel])

  const handleSaveConfig = useCallback(async () => {
    const proxyPort = parseProxyPortInput(localPortInput)
    if (proxyPort === null) {
      setError(`Proxy port is fixed at ${FIXED_PROXY_PORT}.`)
      return
    }

    setSavingConfig(true)
    setError(null)
    try {
      await OcaProxyServiceClient.saveOcaProxyConfig({
        model: localModel,
        reasoningEffort: localReasoningEffort,
        proxyPort,
      })
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingConfig(false)
    }
  }, [localModel, localPortInput, localReasoningEffort, loadStatus])

  const handleToggleProxy = useCallback(async () => {
    setTogglingProxy(true)
    setError(null)
    try {
      if (status?.proxyRunning) {
        await OcaProxyServiceClient.stopOcaProxy()
      } else {
        await OcaProxyServiceClient.startOcaProxy()
      }
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setTogglingProxy(false)
    }
  }, [status?.proxyRunning, loadStatus])

  const handleGenerateKey = useCallback(async () => {
    setGeneratingKey(true)
    setError(null)
    try {
      const res = await OcaProxyServiceClient.generateOcaApiKey()
      setStatus((prev) => (prev ? { ...prev, apiKey: res.apiKey } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingKey(false)
    }
  }, [])

  const handleCopyKey = useCallback(() => {
    if (!status?.apiKey) return
    void navigator.clipboard.writeText(status.apiKey)
    setCopied(true)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 2000)
  }, [status?.apiKey])

  if (!status) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={16} className="animate-spin text-description mr-2" />
        <span className="text-xs text-description">Loading OCA Proxy status...</span>
      </div>
    )
  }

  const configDirty =
    localModel !== status.model ||
    localReasoningEffort !== status.reasoningEffort
  const portError =
    parseProxyPortInput(localPortInput) === null
      ? `Proxy port is fixed at ${FIXED_PROXY_PORT}.`
      : null

  const hostBaseUrl = status.baseUrl || status.localBaseUrl || `http://127.0.0.1:${status.proxyPort}`
  const localBaseUrl = status.localBaseUrl || `http://127.0.0.1:${status.proxyPort}`
  const forwardedBaseUrl = hostBaseUrl !== localBaseUrl ? hostBaseUrl : null
  const authBusy = loadingAuth || status.authInProgress
  const canSaveConfig = !savingConfig && configDirty && !!localModel.trim() && portError === null
  const startBlockedByUnsavedConfig = !status.proxyRunning && configDirty
  const proxyActionDisabled =
    togglingProxy ||
    savingConfig ||
    status.authInProgress ||
    (!status.isAuthenticated && !status.proxyRunning) ||
    startBlockedByUnsavedConfig

  return (
    <div className="flex flex-col gap-4">
      <h3 className="flex items-center gap-1.5 text-md font-semibold">
        <Server size={14} />
        OCA Proxy
      </h3>
      <p className="-mt-2 text-xs text-description">
        Run a local OpenAI-compatible API backed by Oracle Code Assist.
      </p>

      {error && (
        <InlineNotice tone="danger" title="Error">
          {error}
        </InlineNotice>
      )}

      {/* Auth Section */}
      <Card title="Oracle Code Assist Account">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge
              label={status.isAuthenticated ? "Signed In" : "Not Signed In"}
              tone={status.isAuthenticated ? "success" : "neutral"}
            />
          </div>
          {status.isAuthenticated ? (
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => void handleLogout()}
            >
              <LogOut size={12} className="mr-1" />
              Sign Out
            </WorkbenchActionButton>
          ) : authBusy ? (
            <WorkbenchActionButton
              variant="secondary"
              onClick={() => void handleLogout()}
            >
              <Square size={12} className="mr-1" />
              Cancel Sign-In
            </WorkbenchActionButton>
          ) : (
            <WorkbenchActionButton
              variant="primary"
              onClick={() => void handleSignIn()}
              disabled={authBusy}
            >
              {authBusy ? (
                <Loader2 size={12} className="mr-1 animate-spin" />
              ) : (
                <LogIn size={12} className="mr-1" />
              )}
              {authBusy ? "Waiting..." : "Sign in with Oracle Code Assist"}
            </WorkbenchActionButton>
          )}
        </div>
        {authBusy && (
          <p className="text-[11px] text-description">
            A browser window has opened. Waiting for the Oracle SSO callback on{" "}
            <span className="font-mono text-foreground">http://localhost:{status.authCallbackPort}/callback</span>.
          </p>
        )}
        {!status.isAuthenticated && (
          <p className="text-[11px] text-description">
            Oracle Employees: sign in with your Oracle SSO credentials.
          </p>
        )}
        <p className="text-[10px] text-description">
          Oracle SSO uses localhost:{status.authCallbackPort}/callback. The local proxy is also fixed to port {FIXED_PROXY_PORT}, and it will pause during sign-in if needed.
        </p>
      </Card>

      {/* Model & Reasoning Effort */}
      <Card title="Model Configuration">
        <p className="text-[11px] text-description">
          Configure the single model exposed by this proxy and the default reasoning effort used for requests.
        </p>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-description font-medium">Model</label>
            <button
              onClick={() => void handleFetchModels()}
              disabled={loadingModels || !status.isAuthenticated || status.authInProgress}
              className="flex items-center gap-1 text-[10px] text-description hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loadingModels ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RefreshCw size={10} />
              )}
              Refresh
            </button>
          </div>
          <div className="relative">
            <select
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              disabled={!status.isAuthenticated || status.authInProgress}
              className="w-full appearance-none rounded-md border border-input-border bg-input-background px-2 py-1.5 pr-7 text-xs outline-none focus:border-border disabled:opacity-50"
            >
              {localModel && !models.includes(localModel) && (
                <option value={localModel}>{localModel}</option>
              )}
              {models.length === 0 && !localModel && (
                <option value="">-- Refresh to load models --</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-description" />
          </div>
          {models.length === 0 && status.isAuthenticated && (
            <p className="text-[10px] text-description">Click Refresh to load available models from OCA.</p>
          )}
          <p className="text-[10px] text-description">
            Clients using this proxy must send this configured model. Other model IDs are not supported by the proxy.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-description font-medium">Reasoning Effort</label>
          <div className="relative">
            <select
              value={localReasoningEffort}
              onChange={(e) => setLocalReasoningEffort(e.target.value)}
              className="w-full appearance-none rounded-md border border-input-border bg-input-background px-2 py-1.5 pr-7 text-xs outline-none focus:border-border"
            >
              {REASONING_EFFORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-description" />
          </div>
          <p className="text-[10px] text-description">
            Applies to all requests. Can be overridden per-request by the client.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-description font-medium">Proxy Port</label>
          <input
            type="text"
            value={localPortInput}
            readOnly
            disabled
            className="w-32 rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none focus:border-border disabled:opacity-50"
          />
          <p className="text-[10px] text-description">
            Fixed at {FIXED_PROXY_PORT} for compatibility with host access.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--vscode-panel-border)] pt-2">
          <p className="text-[10px] text-description">
            {configDirty
              ? "You have unsaved proxy settings."
              : "Saved settings will be used the next time you start the proxy."}
          </p>
          <WorkbenchActionButton
            onClick={() => void handleSaveConfig()}
            disabled={!canSaveConfig}
            className="px-4"
          >
            {savingConfig ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Save size={14} className="mr-1.5" />
            )}
            {savingConfig ? "Saving..." : "Save Settings"}
          </WorkbenchActionButton>
        </div>
      </Card>

      {/* Proxy Server */}
      <Card title="Proxy Server">
        <p className="text-[11px] text-description">
          Start the local OpenAI-compatible endpoint after the configuration above has been saved.
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge
              label={status.proxyRunning ? "Running" : "Stopped"}
              tone={status.proxyRunning ? "success" : "neutral"}
            />
            {status.proxyRunning && (
              <span className="text-[11px] text-description font-mono">{hostBaseUrl}</span>
            )}
          </div>
          <WorkbenchActionButton
            variant={status.proxyRunning ? "secondary" : "primary"}
            onClick={() => void handleToggleProxy()}
            disabled={proxyActionDisabled}
          >
            {togglingProxy ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : status.proxyRunning ? (
              <Square size={12} className="mr-1" />
            ) : (
              <Triangle size={12} className="mr-1 rotate-90" />
            )}
            {togglingProxy
              ? status.proxyRunning ? "Stopping..." : "Starting..."
              : status.proxyRunning ? "Stop Proxy" : "Start Proxy"}
          </WorkbenchActionButton>
        </div>

        {startBlockedByUnsavedConfig && (
          <p className="text-[10px] text-description">
            Save the configuration above before starting the proxy.
          </p>
        )}

        {status.proxyRunning && forwardedBaseUrl && (
          <div className="flex flex-col gap-1 rounded-md border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,white_6%)] p-2">
            <p className="text-[11px] font-medium text-foreground">Host Access</p>
            <p className="text-[10px] text-description">
              Use this forwarded URL from Windows or macOS when the extension host is remote.
            </p>
            <p className="font-mono text-[10px] text-foreground">
              {hostBaseUrl}
            </p>
            <p className="text-[10px] text-description">
              Remote bind: <span className="font-mono">{localBaseUrl}</span>
            </p>
          </div>
        )}

        {status.proxyRunning && (
          <div className="flex flex-col gap-1 rounded-md bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-2">
            <p className="text-[11px] font-medium text-foreground">API Endpoints</p>
            <p className="font-mono text-[10px] text-description">
              GET {hostBaseUrl}/v1/models
            </p>
            <p className="font-mono text-[10px] text-description">
              POST {hostBaseUrl}/v1/chat/completions
            </p>
          </div>
        )}
      </Card>

      {/* API Key */}
      <Card title="API Key">
        <p className="text-xs text-description">
          Use this key to authenticate requests to the local proxy.
        </p>
        <WorkbenchCompactActionCluster>
          <code className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-input-border bg-input-background px-2 py-1.5 font-mono text-[11px] text-foreground">
            {status.apiKey || "—"}
          </code>
          <WorkbenchIconActionButton
            onClick={handleCopyKey}
            title="Copy API key"
            disabled={!status.apiKey}
            icon={copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          />
        </WorkbenchCompactActionCluster>
        <WorkbenchInlineActionCluster>
          <WorkbenchActionButton
            variant="secondary"
            onClick={() => void handleGenerateKey()}
            disabled={generatingKey}
          >
            {generatingKey ? (
              <Loader2 size={12} className="mr-1 animate-spin" />
            ) : (
              <KeyRound size={12} className="mr-1" />
            )}
            {generatingKey ? "Generating..." : "Generate New Key"}
          </WorkbenchActionButton>
        </WorkbenchInlineActionCluster>
        <p className="text-[10px] text-description">
          Generating a new key invalidates the previous one.
        </p>
      </Card>

      {/* Usage */}
      {status.proxyRunning && (
        <Card title="Usage Example">
          <p className="text-[11px] text-description">Configure any OpenAI-compatible client:</p>
          <div className="rounded-md bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-2">
            <pre className="overflow-x-auto text-[10px] text-description font-mono whitespace-pre-wrap break-all">
{`base_url = "${hostBaseUrl}/v1"
api_key  = "${status.apiKey || "your-api-key"}"
model    = "${status.model || "oca/gpt-5.4"}"`}
            </pre>
          </div>
          {forwardedBaseUrl && (
            <p className="text-[10px] text-description">
              This URL is forwarded from <span className="font-mono">{localBaseUrl}</span> because the extension is running remotely.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
