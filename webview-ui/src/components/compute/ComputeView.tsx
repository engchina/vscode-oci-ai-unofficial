import { clsx } from "clsx"
import { AlertCircle, CheckCircle2, Loader2, MonitorPlay, MonitorStop, Server, SquareTerminal } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { ComputeResource } from "../../services/types"
import { DEFAULT_SSH_USERNAME, SSH_CONFIG_STORAGE_KEY, loadSshConfig, saveSshConfig, type HostPreference, type SshConfig } from "../../sshConfig"
import GuardrailDialog from "../common/GuardrailDialog"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge, { LifecycleBadge } from "../ui/StatusBadge"
import { WorkbenchEmptyState, WorkbenchLoadingState } from "../workbench/DatabaseWorkbenchChrome"
import {
  WorkbenchInventoryFilterEmpty,
  WorkbenchInventoryGroupHeading,
  WorkbenchInventoryRegionHeading,
  WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import {
  WorkbenchActionButton,
  WorkbenchDismissButton,
  WorkbenchGuardrailActionButton,
  WorkbenchInlineActionCluster,
  WorkbenchRevealButton,
} from "../workbench/WorkbenchActionButtons"
import { WorkbenchCompactFieldRow, WorkbenchCompactInput } from "../workbench/WorkbenchCompactControls"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import type { WorkbenchGuardrailState } from "../workbench/guardrail"
import { buildWorkbenchResourceGuardrailDetails, createStartResourceGuardrail, createStopResourceGuardrail } from "../workbench/guardrail"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"

type ActionState = { id: string; action: "starting" | "stopping" } | null
type RecentActionState = {
  resourceId: string
  resourceName: string
  message: string
  timestamp: number
} | null

const TRANSITIONAL_STATES = new Set(["STARTING", "STOPPING", "PROVISIONING", "TERMINATING"])
const POLL_INTERVAL_MS = 5000
const SSH_USER_OVERRIDES_STORAGE_KEY = "ociAi.compute.sshUserOverrides"
const SSH_USER_OVERRIDES_MIGRATION_V2_KEY = "ociAi.compute.sshUserOverridesMigration.v2"
const LEGACY_COMPUTE_DEFAULT_USERNAME = "ubuntu"
const SSH_KEY_OVERRIDES_STORAGE_KEY = "ociAi.compute.sshKeyOverrides"

export default function ComputeView() {
  const { activeProfile, profilesConfig, tenancyOcid, computeCompartmentIds, navigateToView } = useExtensionState()
  const { setPendingSelection, setResource } = useWorkbenchInsight()
  const [instances, setInstances] = useState<ComputeResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionState, setActionState] = useState<ActionState>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [sshConfig, setSshConfig] = useState<SshConfig>(loadSshConfig)
  const [sshUserOverrides, setSshUserOverrides] = useState<Record<string, string>>(loadSshUserOverrides)
  const [sshKeyOverrides, setSshKeyOverrides] = useState<Record<string, string>>(loadSshKeyOverrides)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [highlightedInstanceId, setHighlightedInstanceId] = useState<string | null>(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState("")
  const actionTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const instanceItemRefs = useRef(new Map<string, HTMLElement>())

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return instances
    return instances.filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
  }, [instances, query])
  const grouped = useMemo(() => groupComputeByCompartmentAndRegion(filtered), [filtered])
  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  )
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

  const revealSelectedInstance = useCallback(() => {
    if (!selectedInstance) {
      return
    }
    if (query) {
      setQuery("")
    }
    setHighlightedInstanceId(selectedInstance.id)
  }, [query, selectedInstance])

  useEffect(() => {
    if (!selectedInstance) {
      setResource(null)
      return
    }

    setResource({
      view: "compute",
      title: selectedInstance.name,
      eyebrow: "Selected Instance",
      resourceId: selectedInstance.id,
      badge: {
        label: selectedInstance.lifecycleState,
        tone: toneFromLifecycleState(selectedInstance.lifecycleState),
      },
      metrics: [
        { label: "Region", value: selectedInstance.region || "default" },
        { label: "Public IP", value: selectedInstance.publicIp || "-" },
        { label: "Private IP", value: selectedInstance.privateIp || "-" },
        { label: "SSH Host", value: resolveSshHost(selectedInstance, sshConfig.hostPreference) || "-" },
      ],
      notes: [
        `Host preference: ${sshConfig.hostPreference}`,
        `SSH user override: ${sshUserOverrides[selectedInstance.id] || sshConfig.username || DEFAULT_SSH_USERNAME}`,
      ],
      actions: [
        ...(query
          ? [{
            label: "Clear Filter",
            run: () => setQuery(""),
            variant: "ghost" as const,
          }]
          : []),
        {
          label: selectedInstance.vcnId ? "Open VCN" : "Open VCN Inventory",
          run: () => {
            if (selectedInstance.vcnId) {
              setPendingSelection({
                view: "vcn",
                targetId: selectedInstance.vcnId,
              })
            }
            navigateToView("vcn")
          },
          variant: "secondary",
        },
        {
          label: "Show in List",
          run: revealSelectedInstance,
          variant: "ghost",
        },
      ],
    })

    return () => setResource(null)
  }, [navigateToView, query, revealSelectedInstance, selectedInstance, setPendingSelection, setResource, sshConfig.hostPreference, sshConfig.username, sshUserOverrides])

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
      const nextInstances = res.instances ?? []
      setInstances(nextInstances)
      if (!selectedInstanceId && nextInstances.length > 0) {
        setSelectedInstanceId(nextInstances[0].id)
      }
      if (selectedInstanceId && !nextInstances.some((instance) => instance.id === selectedInstanceId)) {
        setSelectedInstanceId(nextInstances[0]?.id ?? "")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedCompartmentIds, selectedInstanceId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (actionTimerRef.current !== null) {
      window.clearTimeout(actionTimerRef.current)
      actionTimerRef.current = null
    }
    if (!recentAction) {
      return
    }
    actionTimerRef.current = window.setTimeout(() => {
      actionTimerRef.current = null
      setRecentAction(null)
    }, 3200)
    return () => {
      if (actionTimerRef.current !== null) {
        window.clearTimeout(actionTimerRef.current)
        actionTimerRef.current = null
      }
    }
  }, [recentAction])

  useEffect(() => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
    if (!highlightedInstanceId) {
      return
    }
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null
      setHighlightedInstanceId(null)
    }, 2200)
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [highlightedInstanceId])

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

  useEffect(() => {
    if (!highlightedInstanceId || !filtered.some((item) => item.id === highlightedInstanceId)) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      instanceItemRefs.current.get(highlightedInstanceId)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [filtered, highlightedInstanceId])

  const handleStart = useCallback(
    async (id: string, region?: string) => {
      setActionState({ id, action: "starting" })
      try {
        await ResourceServiceClient.startCompute(id, region)
        await load()
        const instance = instances.find((item) => item.id === id)
        setHighlightedInstanceId(id)
        setRecentAction({
          resourceId: id,
          resourceName: instance?.name ?? id,
          message: "Start requested for",
          timestamp: Date.now(),
        })
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
        const instance = instances.find((item) => item.id === id)
        setHighlightedInstanceId(id)
        setRecentAction({
          resourceId: id,
          resourceName: instance?.name ?? id,
          message: "Stop requested for",
          timestamp: Date.now(),
        })
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
        setHighlightedInstanceId(instance.id)
        setRecentAction({
          resourceId: instance.id,
          resourceName: instance.name,
          message: "Opened SSH session for",
          timestamp: Date.now(),
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setConnectingId(null)
      }
    },
    [sshConfig, sshUserOverrides, sshKeyOverrides],
  )

  const handleGuardedAction = useCallback(async () => {
    if (!guardrail) return
    try {
      await guardrail.onConfirm()
      setGuardrail(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardrail(null)
    }
  }, [guardrail])

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

  const revealInstance = useCallback((instanceId: string) => {
    setQuery("")
    setSelectedInstanceId(instanceId)
    setHighlightedInstanceId(instanceId)
  }, [])

  return (
    <FeaturePageLayout
      title="Compute Instances"
      description="Browse instances by compartment, manage lifecycle, and launch SSH sessions."
      icon={<Server size={16} />}
      status={isPolling ? <StatusBadge label="Auto-refreshing" tone="warning" className="animate-pulse" /> : undefined}
      actions={(
        <WorkbenchRefreshButton
          onClick={load}
          disabled={loading}
          spinning={loading}
          title={isPolling ? "Auto-refreshing every 5s" : "Refresh"}
        />
      )}
      controls={(
        <div className="flex flex-col gap-1.5">
          <CompartmentSelector featureKey="compute" multiple />
          {instances.length > 0 && (
            <FeatureSearchInput
              value={query}
              onChange={setQuery}
              placeholder="Filter instances..."
            />
          )}
        </div>
      )}
    >
      <div className="flex h-full min-h-0 flex-col px-2 py-2">
        {error && (
          <InlineNotice tone="danger" size="md" icon={<AlertCircle size={13} />} className="mb-2">
            {error}
          </InlineNotice>
        )}

        {recentAction && (
          <InlineNotice
            tone="info"
            icon={<CheckCircle2 size={14} className="text-[var(--vscode-testing-iconPassed)]" />}
            className="mb-2"
            actions={(
              <>
                <WorkbenchRevealButton onClick={() => revealInstance(recentAction.resourceId)} title="Show this instance in the list" label="Show Instance" />
                <WorkbenchDismissButton onClick={() => setRecentAction(null)} title="Dismiss" />
              </>
            )}
          >
            <div className="min-w-0">
              {recentAction.message} <span className="text-[var(--vscode-foreground)]">{recentAction.resourceName}</span> {formatRecentActionAge(recentAction.timestamp)}
            </div>
          </InlineNotice>
        )}

        {loading && instances.length === 0 ? (
          <WorkbenchLoadingState
            label="Loading instances..."
            className="min-h-[140px] py-4"
          />
        ) : instances.length === 0 ? (
          <div className="flex flex-1">
            <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <section className="h-full overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_76%,white_24%)]">
              <div className="flex h-full min-h-0 flex-col p-2">
                <WorkbenchInventorySummary
                  label="Instance inventory"
                  count={filtered.length === instances.length
                    ? `${instances.length} instance${instances.length !== 1 ? "s" : ""}`
                    : `${filtered.length} of ${instances.length} instances`}
                  description="Manage SSH settings and lifecycle actions directly inside each compute instance card."
                />

                {filtered.length === 0 ? (
                  <div className="mt-2">
                    <WorkbenchInventoryFilterEmpty message="No instances match your filter." />
                  </div>
                ) : (
                  <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                    {grouped.map((compartmentGroup) => (
                      <div key={compartmentGroup.compartmentId} className="mb-2">
                        <WorkbenchInventoryGroupHeading>
                          {compartmentNameById.get(compartmentGroup.compartmentId) ?? compartmentGroup.compartmentId}
                        </WorkbenchInventoryGroupHeading>
                        <div className="flex flex-col gap-2">
                          {compartmentGroup.regions.map((regionGroup) => (
                            <div key={`${compartmentGroup.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                              <WorkbenchInventoryRegionHeading>
                                {regionGroup.region}
                              </WorkbenchInventoryRegionHeading>
                              {regionGroup.instances.map((instance) => (
                                <InstanceCard
                                  key={`${instance.id}-${instance.region ?? "default"}`}
                                  instance={instance}
                                  actionState={actionState}
                                  connectingId={connectingId}
                                  selected={instance.id === selectedInstanceId}
                                  highlighted={highlightedInstanceId === instance.id}
                                  onRegisterRef={(node) => {
                                    if (node) {
                                      instanceItemRefs.current.set(instance.id, node)
                                    } else {
                                      instanceItemRefs.current.delete(instance.id)
                                    }
                                  }}
                                  onSelect={() => setSelectedInstanceId(instance.id)}
                                  sshConfig={sshConfig}
                                  sshUserOverride={sshUserOverrides[instance.id] || ""}
                                  sshKeyOverride={sshKeyOverrides[instance.id] || ""}
                                  onStart={handleStart}
                                  onStop={handleStop}
                                  onRequestGuardrail={setGuardrail}
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
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      <GuardrailDialog
        open={guardrail !== null}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details ?? []}
        tone={guardrail?.tone}
        busy={actionState !== null}
        onCancel={() => {
          if (!actionState) {
            setGuardrail(null)
          }
        }}
        onConfirm={handleGuardedAction}
      />
    </FeaturePageLayout>
  )
}

function InstanceCard({
  instance,
  actionState,
  connectingId,
  selected,
  highlighted,
  onRegisterRef,
  onSelect,
  sshConfig,
  sshUserOverride,
  sshKeyOverride,
  onStart,
  onStop,
  onRequestGuardrail,
  onConnect,
  onChangeSshUserOverride,
  onChangeSshKeyOverride,
  showConnection,
  showLifecycle,
}: {
  instance: ComputeResource
  actionState: ActionState
  connectingId: string | null
  selected: boolean
  highlighted: boolean
  onRegisterRef: (node: HTMLElement | null) => void
  onSelect: () => void
  sshConfig: SshConfig
  sshUserOverride: string
  sshKeyOverride: string
  onStart: (id: string, region?: string) => void
  onStop: (id: string, region?: string) => void
  onRequestGuardrail: (value: WorkbenchGuardrailState) => void
  onConnect: (instance: ComputeResource) => void
  onChangeSshUserOverride: (instanceId: string, username: string) => void
  onChangeSshKeyOverride: (instanceId: string, keyPath: string) => void
  showConnection?: boolean
  showLifecycle?: boolean
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

  const _showConnection = showConnection ?? true
  const _showLifecycle = showLifecycle ?? true

  return (
    <div
      ref={onRegisterRef}
      onMouseDownCapture={onSelect}
      onFocusCapture={onSelect}
      className={clsx(
        "flex flex-col gap-2 rounded-[2px] border bg-[var(--vscode-editor-background)] p-2 transition-colors",
        selected && highlighted
          ? "border-[var(--vscode-focusBorder)] bg-[color-mix(in_srgb,var(--vscode-list-hoverBackground)_82%,var(--vscode-button-background)_18%)]"
          : selected
            ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-hoverBackground)]"
            : highlighted
              ? "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,var(--vscode-button-background)_18%)]"
              : "border-[var(--vscode-panel-border)] hover:bg-[var(--vscode-list-hoverBackground)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-[var(--vscode-foreground)]">{instance.name}</span>
          <span className="truncate text-[11px] text-description">{instance.id}</span>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-[11px] text-description">Public IP: {instance.publicIp || "-"}</span>
            <span className="text-[11px] text-description">Private IP: {instance.privateIp || "-"}</span>
          </div>
          {_showConnection && (
            <>
              <WorkbenchCompactFieldRow className="mt-2" label="SSH User" labelClassName="w-14 font-semibold text-[var(--vscode-foreground)]">
                <WorkbenchCompactInput
                  type="text"
                  value={sshUserOverride}
                  onChange={(e) => onChangeSshUserOverride(instance.id, e.target.value)}
                  placeholder={defaultUsername}
                  className="h-[22px] px-1.5 text-[11px]"
                  title="Per-instance SSH username override"
                />
              </WorkbenchCompactFieldRow>
              <WorkbenchCompactFieldRow className="mt-1" label="Identity" labelClassName="w-14 font-semibold text-[var(--vscode-foreground)]">
                <WorkbenchCompactInput
                  type="text"
                  value={sshKeyOverride}
                  onChange={(e) => onChangeSshKeyOverride(instance.id, e.target.value)}
                  placeholder={sshConfig.privateKeyPath.trim() || "~/.ssh/id_rsa"}
                  className="h-[22px] px-1.5 text-[11px]"
                  title="Per-instance private key path override (e.g. ~/.ssh/id_rsa)"
                />
              </WorkbenchCompactFieldRow>
            </>
          )}
        </div>
        <LifecycleBadge state={instance.lifecycleState} />
      </div>

      <WorkbenchInlineActionCluster>
        {_showLifecycle && (
          <WorkbenchGuardrailActionButton
            disabled={isActing || !isStopped}
            guardrail={createStartResourceGuardrail({
              resourceKind: "compute-instance",
              details: buildWorkbenchResourceGuardrailDetails({
                resourceLabel: "Instance",
                resourceName: instance.name,
                region: instance.region || "default",
                extras: [
                  { label: "Public IP", value: instance.publicIp || "None" },
                ],
              }),
              onConfirm: async () => {
                await onStart(instance.id, instance.region)
              },
            })}
            onRequestGuardrail={onRequestGuardrail}
            busy={isActing && actionState?.action === "starting"}
            idleIcon={<MonitorPlay size={12} />}
            label="Start"
          />
        )}
        {_showLifecycle && (
          <WorkbenchGuardrailActionButton
            disabled={isActing || !isRunning}
            guardrail={createStopResourceGuardrail({
              resourceKind: "compute-instance",
              details: buildWorkbenchResourceGuardrailDetails({
                resourceLabel: "Instance",
                resourceName: instance.name,
                region: instance.region || "default",
                extras: [
                  { label: "Private IP", value: instance.privateIp || "None" },
                ],
              }),
              onConfirm: async () => {
                await onStop(instance.id, instance.region)
              },
            })}
            onRequestGuardrail={onRequestGuardrail}
            busy={isActing && actionState?.action === "stopping"}
            idleIcon={<MonitorStop size={12} />}
            label="Stop"
          />
        )}
        {_showConnection && (
          <WorkbenchActionButton
            disabled={!canConnect}
            onClick={() => onConnect(instance)}
            title={connectReason}
          >
            {isConnecting ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
            SSH Connect
          </WorkbenchActionButton>
        )}
      </WorkbenchInlineActionCluster>
    </div>
  )
}

function formatRecentActionAge(timestamp: number): string {
  const ageMs = Math.max(0, Date.now() - timestamp)
  if (ageMs < 5000) {
    return "just now"
  }
  return `${Math.round(ageMs / 1000)}s ago`
}

function EmptyState({ hasSelectedCompartments }: { hasSelectedCompartments: boolean }) {
  return (
    <WorkbenchEmptyState
      title={hasSelectedCompartments ? "No compute instances found" : "No compartment selected"}
      description={hasSelectedCompartments
        ? "No instances found in the selected compartments."
        : "Please select one or more compartments."}
      icon={<Server size={22} />}
    />
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
