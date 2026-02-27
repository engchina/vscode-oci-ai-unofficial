import { clsx } from "clsx"
import { AlertCircle, Loader2, MonitorPlay, MonitorStop, RefreshCw, Search, Server, SquareTerminal } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { ComputeResource } from "../../services/types"
import { DEFAULT_SSH_USERNAME, SSH_CONFIG_STORAGE_KEY, loadSshConfig, saveSshConfig, type HostPreference, type SshConfig } from "../../sshConfig"
import Button from "../ui/Button"
import CompartmentSelector from "../ui/CompartmentSelector"

type ActionState = { id: string; action: "starting" | "stopping" } | null

const TRANSITIONAL_STATES = new Set(["STARTING", "STOPPING", "PROVISIONING", "TERMINATING"])
const POLL_INTERVAL_MS = 5000
const SSH_USER_OVERRIDES_STORAGE_KEY = "ociAi.compute.sshUserOverrides"
const SSH_USER_OVERRIDES_MIGRATION_V2_KEY = "ociAi.compute.sshUserOverridesMigration.v2"
const LEGACY_COMPUTE_DEFAULT_USERNAME = "ubuntu"
const SSH_KEY_OVERRIDES_STORAGE_KEY = "ociAi.compute.sshKeyOverrides"

export default function ComputeView() {
  const { activeProfile, profilesConfig, tenancyOcid, computeCompartmentIds } = useExtensionState()
  const [instances, setInstances] = useState<ComputeResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionState, setActionState] = useState<ActionState>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [sshConfig, setSshConfig] = useState<SshConfig>(loadSshConfig)
  const [sshUserOverrides, setSshUserOverrides] = useState<Record<string, string>>(loadSshUserOverrides)
  const [sshKeyOverrides, setSshKeyOverrides] = useState<Record<string, string>>(loadSshKeyOverrides)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return instances
    return instances.filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
  }, [instances, query])
  const grouped = useMemo(() => groupComputeByCompartmentAndRegion(filtered), [filtered])
  const compartmentNameById = useMemo(() => {
    const map = new Map<string, string>()
    const rootId = tenancyOcid?.trim()
    if (rootId) {
      map.set(rootId, "Root (Tenancy)")
    }
    const activeProfileConfig = profilesConfig.find((p) => p.name === activeProfile)
    for (const c of activeProfileConfig?.compartments ?? []) {
      if (c.id?.trim()) {
        map.set(c.id.trim(), c.name?.trim() || c.id.trim())
      }
    }
    return map
  }, [activeProfile, profilesConfig, tenancyOcid])
  const selectedCompartmentIds = useMemo(
    () => computeCompartmentIds.map((id) => id.trim()).filter((id) => id.length > 0),
    [computeCompartmentIds],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (selectedCompartmentIds.length === 0) {
      setInstances([])
      setLoading(false)
      return
    }
    try {
      const res = await ResourceServiceClient.listCompute()
      setInstances(res.instances ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedCompartmentIds])

  useEffect(() => {
    load()
  }, [load])

  // Extension host can push refresh signals (e.g. command palette refresh).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data
      if (
        msg?.type === "grpc_response" &&
        msg?.grpc_response?.request_id === "__refresh__" &&
        msg?.grpc_response?.message?.refresh
      ) {
        void load()
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [load])

  // Auto-poll every 5s while any instance is in a transitional state
  const isPolling = instances.some(i => TRANSITIONAL_STATES.has(i.lifecycleState))
  useEffect(() => {
    if (!isPolling) return
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isPolling, load])

  const handleStart = useCallback(
    async (id: string, region?: string) => {
      setActionState({ id, action: "starting" })
      try {
        await ResourceServiceClient.startCompute(id, region)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setActionState(null)
      }
    },
    [load],
  )

  const handleStop = useCallback(
    async (id: string, region?: string) => {
      setActionState({ id, action: "stopping" })
      try {
        await ResourceServiceClient.stopCompute(id, region)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setActionState(null)
      }
    },
    [load],
  )

  const handleConnect = useCallback(
    async (instance: ComputeResource) => {
      const host = resolveSshHost(instance, sshConfig.hostPreference)
      const username = resolveInstanceUsername(instance.id, sshUserOverrides, sshConfig.username)
      if (!host) {
        setError(`No ${sshConfig.hostPreference} IP found for instance "${instance.name}".`)
        return
      }
      if (!username) {
        setError("SSH username is required before connecting.")
        return
      }

      const effectiveKeyPath =
        sshKeyOverrides[instance.id]?.trim() || sshConfig.privateKeyPath.trim() || undefined

      setConnectingId(instance.id)
      try {
        await ResourceServiceClient.connectComputeSsh({
          instanceId: instance.id,
          instanceName: instance.name,
          host,
          username,
          port: sshConfig.port,
          privateKeyPath: effectiveKeyPath,
          disableHostKeyChecking: sshConfig.disableHostKeyChecking,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setConnectingId(null)
      }
    },
    [sshConfig, sshUserOverrides, sshKeyOverrides],
  )

  useEffect(() => {
    saveSshConfig(sshConfig)
  }, [sshConfig])

  useEffect(() => {
    const syncSshConfig = () => {
      setSshConfig(loadSshConfig())
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SSH_CONFIG_STORAGE_KEY || event.key === null) {
        syncSshConfig()
      }
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncSshConfig()
      }
    }

    window.addEventListener("focus", syncSshConfig)
    window.addEventListener("storage", handleStorage)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("focus", syncSshConfig)
      window.removeEventListener("storage", handleStorage)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(SSH_USER_OVERRIDES_STORAGE_KEY, JSON.stringify(sshUserOverrides))
    } catch {
      // Ignore local persistence failures in restricted webview environments.
    }
  }, [sshUserOverrides])

  useEffect(() => {
    try {
      window.localStorage.setItem(SSH_KEY_OVERRIDES_STORAGE_KEY, JSON.stringify(sshKeyOverrides))
    } catch {
      // Ignore local persistence failures in restricted webview environments.
    }
  }, [sshKeyOverrides])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
        <div className="flex min-w-0 items-center gap-2">
          <Server size={14} className="text-[var(--vscode-icon-foreground)]" />
          <div className="flex min-w-0 flex-col">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">Compute Instances</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isPolling && <span className="text-[10px] text-warning animate-pulse mr-2">Refreshing...</span>}
          <Button
            variant="icon"
            size="icon"
            onClick={load}
            disabled={loading}
            title={isPolling ? "Auto-refreshing every 5s" : "Refresh"}
          >
            <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="border-b border-[var(--vscode-panel-border)] px-3 pt-3 pb-2 flex flex-col gap-2 bg-[var(--vscode-editor-background)]">
        <CompartmentSelector featureKey="compute" multiple />
        {instances.length > 0 && (
          <div className="flex items-center gap-2 rounded-[2px] border border-input-border bg-input-background px-2 py-1 focus-within:outline focus-within:outline-1 focus-within:outline-[var(--vscode-focusBorder)] focus-within:-outline-offset-1">
            <Search size={12} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter instances..."
              className="flex-1 bg-transparent text-[13px] text-input-foreground outline-none placeholder:text-input-placeholder"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-xs text-error">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && instances.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-4 text-[12px] text-description">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading instances...</span>
          </div>
        ) : instances.length === 0 ? (
          <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
        ) : (
          <div className="flex flex-col gap-3">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-description">
              {filtered.length === instances.length
                ? `${instances.length} Instance${instances.length !== 1 ? "s" : ""}`
                : `${filtered.length} of ${instances.length} Instances`}
            </h4>
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-description">No instances match your filter.</p>
            ) : (
              grouped.map((compartmentGroup) => (
                <div key={compartmentGroup.compartmentId} className="mb-4">
                  <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--vscode-sideBarTitle-foreground)]">
                    {compartmentNameById.get(compartmentGroup.compartmentId) ?? compartmentGroup.compartmentId}
                  </h5>
                  <div className="flex flex-col gap-3">
                    {compartmentGroup.regions.map((regionGroup) => (
                      <div key={`${compartmentGroup.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                        <h6 className="text-[10px] font-semibold uppercase tracking-wider text-description border-b border-[var(--vscode-panel-border)] pb-1">
                          {regionGroup.region}
                        </h6>
                        {regionGroup.instances.map((instance) => (
                          <InstanceCard
                            key={`${instance.id}-${instance.region ?? "default"}`}
                            instance={instance}
                            actionState={actionState}
                            connectingId={connectingId}
                            sshConfig={sshConfig}
                            sshUserOverride={sshUserOverrides[instance.id] || ""}
                            sshKeyOverride={sshKeyOverrides[instance.id] || ""}
                            onStart={handleStart}
                            onStop={handleStop}
                            onConnect={handleConnect}
                            onChangeSshUserOverride={(instanceId, username) =>
                              setSshUserOverrides((prev) => ({ ...prev, [instanceId]: username }))
                            }
                            onChangeSshKeyOverride={(instanceId, keyPath) =>
                              setSshKeyOverrides((prev) => ({ ...prev, [instanceId]: keyPath }))
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function InstanceCard({
  instance,
  actionState,
  connectingId,
  sshConfig,
  sshUserOverride,
  sshKeyOverride,
  onStart,
  onStop,
  onConnect,
  onChangeSshUserOverride,
  onChangeSshKeyOverride,
}: {
  instance: ComputeResource
  actionState: ActionState
  connectingId: string | null
  sshConfig: SshConfig
  sshUserOverride: string
  sshKeyOverride: string
  onStart: (id: string, region?: string) => void
  onStop: (id: string, region?: string) => void
  onConnect: (instance: ComputeResource) => void
  onChangeSshUserOverride: (instanceId: string, username: string) => void
  onChangeSshKeyOverride: (instanceId: string, keyPath: string) => void
}) {
  const isActing = actionState?.id === instance.id
  const isConnecting = connectingId === instance.id
  const isRunning = instance.lifecycleState === "RUNNING"
  const isStopped = instance.lifecycleState === "STOPPED"
  const host = resolveSshHost(instance, sshConfig.hostPreference)
  const defaultUsername = sshConfig.username.trim() || DEFAULT_SSH_USERNAME
  const effectiveUsername = resolveInstanceUsername(instance.id, { [instance.id]: sshUserOverride }, defaultUsername)
  const canConnect = isRunning && !isActing && !isConnecting && Boolean(host) && Boolean(effectiveUsername)
  const connectReason = !isRunning
    ? "Instance must be RUNNING"
    : !host
      ? "No reachable IP found"
      : !effectiveUsername
        ? "Set SSH username first"
        : ""

  return (
    <div className="flex flex-col gap-3 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-[var(--vscode-foreground)]">{instance.name}</span>
          <span className="truncate text-[11px] text-description">{instance.id}</span>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-[11px] text-description">Public IP: {instance.publicIp || "-"}</span>
            <span className="text-[11px] text-description">Private IP: {instance.privateIp || "-"}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold text-[var(--vscode-foreground)] w-14">SSH User</span>
            <input
              type="text"
              value={sshUserOverride}
              onChange={(e) => onChangeSshUserOverride(instance.id, e.target.value)}
              placeholder={defaultUsername}
              className="h-[22px] min-w-0 flex-1 rounded-[2px] border border-input-border bg-input-background px-1.5 text-[11px] outline-none focus:border-[var(--vscode-focusBorder)]"
              title="Per-instance SSH username override"
            />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold text-[var(--vscode-foreground)] w-14">Identity</span>
            <input
              type="text"
              value={sshKeyOverride}
              onChange={(e) => onChangeSshKeyOverride(instance.id, e.target.value)}
              placeholder={sshConfig.privateKeyPath.trim() || "~/.ssh/id_rsa"}
              className="h-[22px] min-w-0 flex-1 rounded-[2px] border border-input-border bg-input-background px-1.5 text-[11px] outline-none focus:border-[var(--vscode-focusBorder)]"
              title="Per-instance private key path override (e.g. ~/.ssh/id_rsa)"
            />
          </div>
        </div>
        <LifecycleBadge state={instance.lifecycleState} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={isActing || !isStopped}
          onClick={() => onStart(instance.id, instance.region)}
          className="flex items-center gap-1.5"
        >
          {isActing && actionState?.action === "starting" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <MonitorPlay size={12} />
          )}
          Start
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={isActing || !isRunning}
          onClick={() => onStop(instance.id, instance.region)}
          className="flex items-center gap-1.5"
        >
          {isActing && actionState?.action === "stopping" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <MonitorStop size={12} />
          )}
          Stop
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canConnect}
          onClick={() => onConnect(instance)}
          title={connectReason}
          className="flex items-center gap-1.5"
        >
          {isConnecting ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
          SSH Connect
        </Button>
      </div>
    </div>
  )
}

function LifecycleBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    RUNNING: "text-success bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,green_20%)] border-success/30",
    STOPPED: "text-description bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] border-border-panel",
    STOPPING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    STARTING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    TERMINATED: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
  }
  const cls = colorMap[state] ?? "text-description border-border-panel"
  return (
    <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", cls)}>
      {state}
    </span>
  )
}

function EmptyState({ hasSelectedCompartments }: { hasSelectedCompartments: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border-panel bg-list-background-hover">
        <Server size={22} className="text-description" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">
          {hasSelectedCompartments ? "No compute instances found" : "No compartment selected"}
        </p>
        <p className="mt-1 text-xs text-description">
          {hasSelectedCompartments
            ? "No instances found in the selected compartments."
            : "Please select one or more compartments."}
        </p>
      </div>
    </div>
  )
}

function groupComputeByCompartmentAndRegion(instances: ComputeResource[]): { compartmentId: string; regions: { region: string; instances: ComputeResource[] }[] }[] {
  const compartmentMap = new Map<string, Map<string, ComputeResource[]>>()
  for (const instance of instances) {
    const compartmentId = instance.compartmentId || "unknown-compartment"
    const region = instance.region || "default"
    if (!compartmentMap.has(compartmentId)) {
      compartmentMap.set(compartmentId, new Map<string, ComputeResource[]>())
    }
    const regionMap = compartmentMap.get(compartmentId)!
    if (!regionMap.has(region)) {
      regionMap.set(region, [])
    }
    regionMap.get(region)!.push(instance)
  }
  return [...compartmentMap.entries()].map(([compartmentId, regions]) => ({
    compartmentId,
    regions: [...regions.entries()].map(([region, groupedInstances]) => ({ region, instances: groupedInstances })),
  }))
}

function loadSshUserOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SSH_USER_OVERRIDES_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const cleaned: Record<string, string> = {}
    for (const [instanceId, username] of Object.entries(parsed || {})) {
      if (typeof username === "string") {
        cleaned[instanceId] = username
      }
    }
    // One-time migration: drop legacy auto-filled "ubuntu" overrides so instances
    // fall back to Compute SSH Defaults unless users explicitly override again.
    const migrated = window.localStorage.getItem(SSH_USER_OVERRIDES_MIGRATION_V2_KEY) === "1"
    if (!migrated) {
      let changed = false
      for (const [instanceId, username] of Object.entries(cleaned)) {
        if (username.trim().toLowerCase() === LEGACY_COMPUTE_DEFAULT_USERNAME) {
          delete cleaned[instanceId]
          changed = true
        }
      }
      if (changed) {
        window.localStorage.setItem(SSH_USER_OVERRIDES_STORAGE_KEY, JSON.stringify(cleaned))
      }
      window.localStorage.setItem(SSH_USER_OVERRIDES_MIGRATION_V2_KEY, "1")
    }
    return cleaned
  } catch {
    return {}
  }
}

function loadSshKeyOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SSH_KEY_OVERRIDES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const cleaned: Record<string, string> = {}
    for (const [instanceId, keyPath] of Object.entries(parsed || {})) {
      if (typeof keyPath === "string") {
        cleaned[instanceId] = keyPath
      }
    }
    return cleaned
  } catch {
    return {}
  }
}

function resolveSshHost(instance: ComputeResource, preference: HostPreference): string {
  const publicIp = instance.publicIp?.trim() || ""
  const privateIp = instance.privateIp?.trim() || ""
  if (preference === "private") {
    return privateIp || publicIp
  }
  return publicIp || privateIp
}

function resolveInstanceUsername(instanceId: string, overrides: Record<string, string>, fallback: string): string {
  const override = overrides[instanceId]?.trim() || ""
  if (override) {
    return override
  }
  return fallback.trim()
}
