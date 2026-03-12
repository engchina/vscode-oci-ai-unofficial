import { AlertCircle, CheckCircle2, Eye, Loader2, Plus, Shield, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { BastionResource, BastionSessionResource } from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import BastionSshCommandDialog from "./BastionSshCommandDialog"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge, { LifecycleBadge } from "../ui/StatusBadge"
import { WorkbenchEmptyState, WorkbenchLoadingState } from "../workbench/DatabaseWorkbenchChrome"
import WorkbenchActionInventoryCard from "../workbench/WorkbenchActionInventoryCard"
import {
  WorkbenchInventoryFilterEmpty,
  WorkbenchInventoryGroupHeading,
  WorkbenchInventoryRegionHeading,
  WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import {
  WorkbenchCompactActionCluster,
  WorkbenchDismissButton,
  WorkbenchIconDestructiveButton,
  WorkbenchInlineActionCluster,
  WorkbenchRevealButton,
  WorkbenchSecondaryActionButton,
  WorkbenchSelectButton,
  WorkbenchSubmitButton,
} from "../workbench/WorkbenchActionButtons"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import type { WorkbenchGuardrailState } from "../workbench/guardrail"
import {
  buildWorkbenchResourceGuardrailDetails,
  createDeleteResourceGuardrail,
} from "../workbench/guardrail"
import { showInListLabel } from "../workbench/navigationLabels"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"
import type { PreparedBastionSshCommand } from "./bastionSshCommand"

type RecentActionState = {
  bastionId: string
  bastionName: string
  message: string
  detail?: string
  timestamp: number
} | null

type BastionSshCommandState = {
  bastionName: string
  session: BastionSessionResource
} | null

type SessionRefreshBurstState = {
  bastionId: string
  region?: string
  remaining: number
} | null

const BASTION_TRANSITIONAL_STATES = new Set(["CREATING", "UPDATING", "DELETING", "TERMINATING"])
const SESSION_TRANSITIONAL_STATES = new Set(["CREATING", "UPDATING", "DELETING", "TERMINATING"])
const POLL_INTERVAL_MS = 5000
const POST_ACTION_REFRESH_INTERVAL_MS = 1800
const POST_ACTION_REFRESH_ATTEMPTS = 3

export default function BastionView() {
  const { activeProfile, profilesConfig, tenancyOcid, bastionCompartmentIds, navigateToView } = useExtensionState()
  const { pendingSelection, setPendingSelection, setResource } = useWorkbenchInsight()
  const [bastions, setBastions] = useState<BastionResource[]>([])
  const [sessionsByBastion, setSessionsByBastion] = useState<Record<string, BastionSessionResource[]>>({})
  const [loading, setLoading] = useState(true)
  const [loadingSessionCounts, setLoadingSessionCounts] = useState<Record<string, number>>({})
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedBastionId, setSelectedBastionId] = useState("")
  const [highlightedBastionId, setHighlightedBastionId] = useState<string | null>(null)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [sshCommandState, setSshCommandState] = useState<BastionSshCommandState>(null)
  const [launchingSshSessionId, setLaunchingSshSessionId] = useState<string | null>(null)
  const [sessionRefreshBurst, setSessionRefreshBurst] = useState<SessionRefreshBurstState>(null)
  const actionTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const bastionItemRefs = useRef(new Map<string, HTMLDivElement>())
  const bastionLoadRequestIdRef = useRef(0)
  const sessionLoadRequestIdRef = useRef(new Map<string, number>())

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return bastions
    }
    return bastions.filter((bastion) =>
      [
        bastion.name,
        bastion.id,
        bastion.region,
        bastion.targetVcnId,
        bastion.targetSubnetId,
        bastion.dnsProxyStatus,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery)),
    )
  }, [bastions, query])
  const grouped = useMemo(() => groupBastionsByCompartmentAndRegion(filtered), [filtered])

  const selectedBastion = useMemo(
    () => bastions.find((bastion) => bastion.id === selectedBastionId) ?? null,
    [bastions, selectedBastionId],
  )
  const selectedSessions = useMemo(
    () => (selectedBastion ? sessionsByBastion[selectedBastion.id] ?? [] : []),
    [selectedBastion, sessionsByBastion],
  )
  const commandReadyCount = useMemo(
    () => selectedSessions.filter(hasSshCommand).length,
    [selectedSessions],
  )
  const compartmentNameById = useMemo(() => {
    const map = new Map<string, string>()
    const rootId = tenancyOcid?.trim()
    if (rootId) {
      map.set(rootId, "Root (Tenancy)")
    }
    const activeProfileConfig = profilesConfig.find((profile) => profile.name === activeProfile)
    for (const compartment of activeProfileConfig?.compartments ?? []) {
      if (compartment.id?.trim()) {
        map.set(compartment.id.trim(), compartment.name?.trim() || compartment.id.trim())
      }
    }
    return map
  }, [activeProfile, profilesConfig, tenancyOcid])
  const selectedCompartmentIds = useMemo(
    () => bastionCompartmentIds.map((id) => id.trim()).filter((id) => id.length > 0),
    [bastionCompartmentIds],
  )
  const isPolling = useMemo(
    () =>
      bastions.some((bastion) => BASTION_TRANSITIONAL_STATES.has(bastion.lifecycleState))
      || selectedSessions.some((session) => SESSION_TRANSITIONAL_STATES.has(session.lifecycleState)),
    [bastions, selectedSessions],
  )

  const revealBastion = useCallback((bastionId: string) => {
    setQuery("")
    setSelectedBastionId(bastionId)
    setHighlightedBastionId(bastionId)
  }, [])

  const revealSelectedBastion = useCallback(() => {
    if (!selectedBastion) {
      return
    }
    revealBastion(selectedBastion.id)
  }, [revealBastion, selectedBastion])

  const openCreateSessionPage = useCallback((bastion: BastionResource | null) => {
    if (!bastion) {
      return
    }
    setPendingSelection({
      view: "bastionSession",
      targetId: bastion.id,
    })
    navigateToView("bastionSession")
  }, [navigateToView, setPendingSelection])

  const queueSessionRefreshBurst = useCallback((bastionId: string, region?: string) => {
    setSessionRefreshBurst({
      bastionId,
      region,
      remaining: POST_ACTION_REFRESH_ATTEMPTS,
    })
  }, [])

  useEffect(() => {
    if (!selectedBastion) {
      setResource(null)
      return
    }

    const sessionCountLabel = `${selectedSessions.length} session${selectedSessions.length === 1 ? "" : "s"}`
    const commandCountLabel = `${commandReadyCount} command${commandReadyCount === 1 ? "" : "s"} ready`

    setResource({
      view: "bastion",
      title: selectedBastion.name,
      eyebrow: "Selected Bastion",
      resourceId: selectedBastion.id,
      badge: {
        label: selectedBastion.lifecycleState,
        tone: toneFromLifecycleState(selectedBastion.lifecycleState),
      },
      metrics: [
        { label: "Region", value: selectedBastion.region || "default" },
        { label: "Target VCN", value: selectedBastion.targetVcnId || "-" },
        { label: "Target Subnet", value: selectedBastion.targetSubnetId || "-" },
        { label: "Sessions", value: sessionCountLabel },
      ],
      notes: [
        `DNS proxy: ${selectedBastion.dnsProxyStatus || "Unknown"}`,
        `Client allowlist: ${selectedBastion.clientCidrBlockAllowList?.length ?? 0} CIDR entries`,
        commandCountLabel,
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
          label: showInListLabel("Bastion"),
          run: revealSelectedBastion,
          variant: "ghost",
        },
        {
          label: "Create Session",
          run: () => openCreateSessionPage(selectedBastion),
          variant: "secondary",
        },
        {
          label: "Refresh Sessions",
          run: () => {
            void loadSessions(selectedBastion.id, selectedBastion.region)
          },
          variant: "secondary",
        },
      ],
    })

    return () => setResource(null)
  }, [commandReadyCount, openCreateSessionPage, query, revealSelectedBastion, selectedBastion, selectedSessions.length, setResource])

  const loadBastions = useCallback(async () => {
    const requestId = bastionLoadRequestIdRef.current + 1
    bastionLoadRequestIdRef.current = requestId
    setLoading(true)
    setError(null)
    if (selectedCompartmentIds.length === 0) {
      setBastions([])
      setSessionsByBastion({})
      setLoadingSessionCounts({})
      sessionLoadRequestIdRef.current = new Map()
      setSelectedBastionId("")
      setSshCommandState(null)
      setSessionRefreshBurst(null)
      bastionLoadRequestIdRef.current = requestId
      setLoading(false)
      return
    }
    try {
      const response = await ResourceServiceClient.listBastions()
      if (bastionLoadRequestIdRef.current !== requestId) {
        return
      }
      const nextBastions = response.bastions ?? []
      setBastions(nextBastions)
      const validBastionIds = new Set(nextBastions.map((bastion) => bastion.id))
      sessionLoadRequestIdRef.current = new Map(
        [...sessionLoadRequestIdRef.current.entries()].filter(([bastionId]) => validBastionIds.has(bastionId)),
      )
      setSessionsByBastion((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([bastionId]) => validBastionIds.has(bastionId))),
      )
      setLoadingSessionCounts((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([bastionId]) => validBastionIds.has(bastionId))),
      )
      setSelectedBastionId((currentSelectedId) => {
        if (!currentSelectedId && nextBastions.length > 0) {
          return nextBastions[0].id
        }
        if (currentSelectedId && !nextBastions.some((bastion) => bastion.id === currentSelectedId)) {
          return nextBastions[0]?.id ?? ""
        }
        return currentSelectedId
      })
    } catch (err) {
      if (bastionLoadRequestIdRef.current !== requestId) {
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (bastionLoadRequestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }, [selectedCompartmentIds])

  const loadSessions = useCallback(async (bastionId: string, region?: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false
    const requestId = (sessionLoadRequestIdRef.current.get(bastionId) ?? 0) + 1
    sessionLoadRequestIdRef.current.set(bastionId, requestId)
    if (!silent) {
      setLoadingSessionCounts((previous) => ({
        ...previous,
        [bastionId]: (previous[bastionId] ?? 0) + 1,
      }))
    }
    try {
      const response = await ResourceServiceClient.listBastionSessions({ bastionId, region })
      if (sessionLoadRequestIdRef.current.get(bastionId) !== requestId) {
        return
      }
      setSessionsByBastion((previous) => ({ ...previous, [bastionId]: response.sessions ?? [] }))
    } catch (err) {
      if (sessionLoadRequestIdRef.current.get(bastionId) !== requestId) {
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!silent) {
        setLoadingSessionCounts((previous) => {
          const nextCount = Math.max(0, (previous[bastionId] ?? 0) - 1)
          if (nextCount === 0) {
            const { [bastionId]: _removed, ...rest } = previous
            return rest
          }
          return {
            ...previous,
            [bastionId]: nextCount,
          }
        })
      }
    }
  }, [])

  useEffect(() => {
    void loadBastions()
  }, [loadBastions])

  useEffect(() => {
    if (!selectedBastion) {
      return
    }
    void loadSessions(selectedBastion.id, selectedBastion.region)
  }, [loadSessions, selectedBastion])

  useEffect(() => {
    if (pendingSelection?.view !== "bastion") {
      return
    }
    setQuery("")
    setSelectedBastionId(pendingSelection.targetId)
    setHighlightedBastionId(pendingSelection.targetId)
    setPendingSelection(null)
  }, [pendingSelection, setPendingSelection])

  useEffect(() => {
    if (!sessionRefreshBurst) {
      return
    }
    if (!bastions.some((bastion) => bastion.id === sessionRefreshBurst.bastionId)) {
      setSessionRefreshBurst(null)
    }
  }, [bastions, sessionRefreshBurst])

  useEffect(() => {
    if (!sshCommandState) {
      return
    }
    const nextBastion = bastions.find((bastion) => bastion.id === sshCommandState.session.bastionId)
    if (!nextBastion) {
      setSshCommandState(null)
      return
    }
    const cachedSessions = sessionsByBastion[sshCommandState.session.bastionId] ?? []
    const nextSession = cachedSessions.find((session) => session.id === sshCommandState.session.id)
    if (!nextSession) {
      if (Object.prototype.hasOwnProperty.call(sessionsByBastion, sshCommandState.session.bastionId)) {
        setSshCommandState(null)
      }
      return
    }
    if (nextSession !== sshCommandState.session || nextBastion.name !== sshCommandState.bastionName) {
      setSshCommandState({
        bastionName: nextBastion.name,
        session: nextSession,
      })
    }
  }, [bastions, sessionsByBastion, sshCommandState])

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
    if (!highlightedBastionId) {
      return
    }
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null
      setHighlightedBastionId(null)
    }, 2200)
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [highlightedBastionId])

  useEffect(() => {
    if (!highlightedBastionId || !filtered.some((item) => item.id === highlightedBastionId)) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      bastionItemRefs.current.get(highlightedBastionId)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [filtered, highlightedBastionId])

  useEffect(() => {
    if (!isPolling || !selectedBastion) {
      return
    }
    const timer = window.setInterval(() => {
      void loadBastions()
      void loadSessions(selectedBastion.id, selectedBastion.region, { silent: true })
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isPolling, loadBastions, loadSessions, selectedBastion])

  useEffect(() => {
    if (!sessionRefreshBurst || sessionRefreshBurst.remaining <= 0) {
      return
    }
    const timer = window.setTimeout(() => {
      void loadSessions(sessionRefreshBurst.bastionId, sessionRefreshBurst.region, { silent: true })
      setSessionRefreshBurst((current) => {
        if (!current || current.bastionId !== sessionRefreshBurst.bastionId) {
          return current
        }
        return current.remaining <= 1
          ? null
          : { ...current, remaining: current.remaining - 1 }
      })
    }, POST_ACTION_REFRESH_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [loadSessions, sessionRefreshBurst])

  const copySshCommand = useCallback(async (session: BastionSessionResource, bastionName: string, command: string) => {
    if (!command.trim()) {
      setError("No SSH command is available for this session yet.")
      return
    }
    try {
      await navigator.clipboard.writeText(command)
      setRecentAction({
        bastionId: session.bastionId,
        bastionName,
        message: "Copied SSH command for",
        detail: session.name,
        timestamp: Date.now(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const openSshCommandInTerminal = useCallback(async (
    session: BastionSessionResource,
    bastionName: string,
    prepared: PreparedBastionSshCommand,
  ) => {
    if (!prepared.executable.trim() || prepared.args.length === 0) {
      setError("No SSH command is available for this session yet.")
      return
    }

    setLaunchingSshSessionId(session.id)
    try {
      await ResourceServiceClient.runBastionSshCommand({
        sessionId: session.id,
        sessionName: session.name,
        bastionName,
        executable: prepared.executable,
        args: prepared.args,
      })
      setRecentAction({
        bastionId: session.bastionId,
        bastionName,
        message: "Opened SSH command in terminal for",
        detail: session.name,
        timestamp: Date.now(),
      })
      setHighlightedBastionId(session.bastionId)
      setSshCommandState(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLaunchingSshSessionId(null)
    }
  }, [])

  const requestDeleteSession = useCallback((session: BastionSessionResource, bastion: BastionResource) => {
    setGuardrail(createDeleteResourceGuardrail({
      resourceKind: "bastion-session",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Bastion",
        resourceName: bastion.name,
        region: bastion.region || "default",
        extras: [
          { label: "Session", value: session.name },
          { label: "Type", value: getSessionTypeLabel(session) },
          { label: "Target", value: describeSessionTarget(session) },
        ],
      }),
      onConfirm: async () => {
        setDeletingSessionId(session.id)
        try {
          if (sshCommandState?.session.id === session.id) {
            setSshCommandState(null)
          }
          await ResourceServiceClient.deleteBastionSession({ sessionId: session.id, region: bastion.region })
          await loadSessions(bastion.id, bastion.region)
          queueSessionRefreshBurst(bastion.id, bastion.region)
          setRecentAction({
            bastionId: bastion.id,
            bastionName: bastion.name,
            message: "Deleted session from",
            detail: session.name,
            timestamp: Date.now(),
          })
          setHighlightedBastionId(bastion.id)
          setGuardrail(null)
        } finally {
          setDeletingSessionId(null)
        }
      },
    }))
  }, [loadSessions, queueSessionRefreshBurst, sshCommandState])

  const handleGuardedAction = useCallback(async () => {
    if (!guardrail) {
      return
    }
    try {
      await guardrail.onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardrail(null)
    }
  }, [guardrail])

  const activeSshCommand = getSshCommand(sshCommandState?.session)

  return (
    <FeaturePageLayout
      title="Bastions"
      description="Manage OCI Bastions, session lifecycles, and SSH handoff into private resources."
      icon={<Shield size={16} />}
      status={isPolling ? <StatusBadge label="Auto-refreshing" tone="warning" size="compact" className="animate-pulse" /> : undefined}
      actions={(
        <WorkbenchRefreshButton
          onClick={loadBastions}
          disabled={loading}
          spinning={loading}
          title={isPolling ? "Auto-refreshing every 5s" : "Refresh"}
        />
      )}
      controls={(
        <div className="flex flex-col gap-1.5">
          <CompartmentSelector featureKey="bastion" multiple />
          {bastions.length > 0 && (
            <FeatureSearchInput
              value={query}
              onChange={setQuery}
              placeholder="Filter bastions by name, region, VCN, or subnet..."
            />
          )}
        </div>
      )}
    >
      <div className="flex h-full min-h-0 flex-col px-2 py-2">
        {error && (
          <InlineNotice
            tone="danger"
            size="md"
            icon={<AlertCircle size={13} />}
            className="mb-2"
            actions={<WorkbenchDismissButton onClick={() => setError(null)} title="Dismiss" />}
          >
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
                <WorkbenchRevealButton
                  onClick={() => revealBastion(recentAction.bastionId)}
                  title={showInListLabel("Bastion")}
                  label={showInListLabel("Bastion")}
                />
                <WorkbenchDismissButton onClick={() => setRecentAction(null)} title="Dismiss" />
              </>
            )}
          >
            <div className="min-w-0">
              {recentAction.message} <span className="text-[var(--vscode-foreground)]">{recentAction.bastionName}</span>
              {recentAction.detail ? <> · {recentAction.detail}</> : null} {formatRecentActionAge(recentAction.timestamp)}
            </div>
          </InlineNotice>
        )}

        {loading && bastions.length === 0 ? (
          <WorkbenchLoadingState label="Loading bastions..." className="min-h-[140px] py-4" />
        ) : bastions.length === 0 ? (
          <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
        ) : (
          <div className="min-h-0 flex-1">
            <section className="h-full overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
              <div className="flex h-full min-h-0 flex-col p-2">
                <WorkbenchInventorySummary
                  label="Bastion inventory"
                  count={filtered.length === bastions.length
                    ? `${bastions.length} bastion${bastions.length !== 1 ? "s" : ""}`
                    : `${filtered.length} of ${bastions.length} bastions`}
                  description="Select a Bastion, then create sessions, inspect generated SSH commands, and clean up access explicitly from the action row."
                />

                {filtered.length === 0 ? (
                  <div className="mt-2">
                    <WorkbenchInventoryFilterEmpty message="No bastions match your filter." />
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
                              {regionGroup.bastions.map((bastion) => (
                                <BastionCard
                                  key={bastion.id}
                                  bastion={bastion}
                                  selected={bastion.id === selectedBastionId}
                                  highlighted={highlightedBastionId === bastion.id}
                                  onRegisterRef={(node) => {
                                    if (node) {
                                      bastionItemRefs.current.set(bastion.id, node)
                                    } else {
                                      bastionItemRefs.current.delete(bastion.id)
                                    }
                                  }}
                                  onSelect={() => setSelectedBastionId(bastion.id)}
                                  sessions={sessionsByBastion[bastion.id] ?? []}
                                  isLoadingSessions={Boolean(loadingSessionCounts[bastion.id])}
                                  deletingSessionId={deletingSessionId}
                                  onRequestDeleteSession={(session) => requestDeleteSession(session, bastion)}
                                  onOpenCreateSession={() => {
                                    setSelectedBastionId(bastion.id)
                                    openCreateSessionPage(bastion)
                                  }}
                                  onRefreshSessions={() => {
                                    void loadSessions(bastion.id, bastion.region)
                                  }}
                                  onViewSshCommand={(session) => setSshCommandState({ bastionName: bastion.name, session })}
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

      <BastionSshCommandDialog
        open={sshCommandState !== null && activeSshCommand.length > 0}
        bastionName={sshCommandState?.bastionName ?? ""}
        sessionName={sshCommandState?.session.name ?? ""}
        session={sshCommandState?.session ?? null}
        lifecycleState={sshCommandState?.session.lifecycleState ?? ""}
        sessionTypeLabel={getSessionTypeLabel(sshCommandState?.session)}
        targetLabel={describeSessionTarget(sshCommandState?.session)}
        ttlLabel={formatSessionTtl(sshCommandState?.session?.sessionTtlInSeconds)}
        commandTemplate={activeSshCommand}
        onClose={() => setSshCommandState(null)}
        onCopy={(command) => {
          if (!sshCommandState) {
            return
          }
          void copySshCommand(sshCommandState.session, sshCommandState.bastionName, command)
        }}
        onOpenInTerminal={(prepared) => {
          if (!sshCommandState) {
            return
          }
          void openSshCommandInTerminal(sshCommandState.session, sshCommandState.bastionName, prepared)
        }}
        running={launchingSshSessionId === sshCommandState?.session.id}
      />

      <GuardrailDialog
        open={guardrail !== null}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details ?? []}
        tone={guardrail?.tone}
        busy={deletingSessionId !== null}
        onCancel={() => {
          if (!deletingSessionId) {
            setGuardrail(null)
          }
        }}
        onConfirm={handleGuardedAction}
      />
    </FeaturePageLayout>
  )
}

function BastionCard({
  bastion,
  selected,
  highlighted,
  onRegisterRef,
  onSelect,
  sessions,
  isLoadingSessions,
  deletingSessionId,
  onRequestDeleteSession,
  onOpenCreateSession,
  onRefreshSessions,
  onViewSshCommand,
}: {
  bastion: BastionResource
  selected: boolean
  highlighted: boolean
  onRegisterRef: (node: HTMLDivElement | null) => void
  onSelect: () => void
  sessions: BastionSessionResource[]
  isLoadingSessions: boolean
  deletingSessionId: string | null
  onRequestDeleteSession: (session: BastionSessionResource) => void
  onOpenCreateSession: () => void
  onRefreshSessions: () => void
  onViewSshCommand: (session: BastionSessionResource) => void
}) {
  const commandReadyCount = sessions.filter(hasSshCommand).length

  return (
    <WorkbenchActionInventoryCard
      cardRef={onRegisterRef}
      title={bastion.name}
      subtitle={bastion.id}
      selected={selected}
      highlighted={highlighted}
      onSelect={onSelect}
      trailing={<LifecycleBadge state={bastion.lifecycleState} size="compact" />}
      meta={(
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-[11px] text-description">VCN: {bastion.targetVcnId || "-"}</span>
            <span className="text-[11px] text-description">Subnet: {bastion.targetSubnetId || "-"}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-[11px] text-description">DNS Proxy: {bastion.dnsProxyStatus || "Unknown"}</span>
            <span className="text-[11px] text-description">Client CIDRs: {bastion.clientCidrBlockAllowList?.length ?? 0}</span>
          </div>

          {selected && (
            <div className="mt-2 border-t border-[var(--vscode-panel-border)] pt-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-[11px] font-semibold text-[var(--vscode-foreground)]">Sessions</h4>
                  <div className="mt-0.5 text-[10px] text-[var(--vscode-descriptionForeground)]">
                    {sessions.length} loaded · {commandReadyCount} command-ready
                  </div>
                </div>
                <WorkbenchInlineActionCluster className="gap-1">
                  <StatusBadge label={`${sessions.length} total`} size="compact" />
                  {commandReadyCount > 0 ? <StatusBadge label={`${commandReadyCount} ready`} tone="success" size="compact" /> : null}
                </WorkbenchInlineActionCluster>
              </div>

              {isLoadingSessions ? (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--vscode-descriptionForeground)]">
                  <Loader2 size={12} className="animate-spin" /> Loading sessions...
                </div>
              ) : sessions.length === 0 ? (
                <div className="mt-2 text-[11px] text-[var(--vscode-descriptionForeground)]">
                  No active sessions yet. Create a managed SSH or port-forwarding session to generate access details here.
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-1.5">
                  {sessions.map((session) => {
                    const commandReady = hasSshCommand(session)
                    return (
                      <div
                        key={session.id}
                        className="flex flex-col gap-2 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[11px] font-medium text-[var(--vscode-foreground)]">{session.name}</span>
                              <StatusBadge label={getSessionTypeLabel(session)} size="compact" />
                              {commandReady ? <StatusBadge label="Command Ready" tone="success" size="compact" /> : null}
                            </div>
                            <div
                              className="mt-1 truncate text-[10px] text-[var(--vscode-descriptionForeground)]"
                              title={describeSessionTarget(session)}
                            >
                              Target: {describeSessionTarget(session)}
                            </div>
                            <div className="mt-0.5 text-[10px] text-[var(--vscode-descriptionForeground)]">
                              TTL: {formatSessionTtl(session.sessionTtlInSeconds)}
                            </div>
                          </div>
                          <LifecycleBadge state={session.lifecycleState} size="compact" />
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {commandReady && (
                            <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={() => onViewSshCommand(session)}>
                              <Eye size={12} />
                              Open SSH Command
                            </WorkbenchSecondaryActionButton>
                          )}
                          <WorkbenchIconDestructiveButton
                            type="button"
                            variant="icon"
                            size="icon"
                            title="Delete Session"
                            icon={<Trash2 size={12} />}
                            busy={deletingSessionId === session.id}
                            onClick={() => onRequestDeleteSession(session)}
                            className="h-6 w-6 rounded-[2px]"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      actions={(
        <WorkbenchCompactActionCluster>
          <WorkbenchSelectButton selected={selected} onClick={onSelect} />
          {selected && (
            <WorkbenchSubmitButton variant="secondary" onClick={onOpenCreateSession}>
              <Plus size={12} />
              Create Session
            </WorkbenchSubmitButton>
          )}
          {selected && (
            <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={onRefreshSessions} disabled={isLoadingSessions}>
              {isLoadingSessions ? <Loader2 size={12} className="animate-spin" /> : null}
              Refresh Sessions
            </WorkbenchSecondaryActionButton>
          )}
        </WorkbenchCompactActionCluster>
      )}
    />
  )
}

function EmptyState({ hasSelectedCompartments }: { hasSelectedCompartments: boolean }) {
  return (
    <WorkbenchEmptyState
      title={hasSelectedCompartments ? "No Bastions Found" : "No Compartment Selected"}
      description={hasSelectedCompartments
        ? "No bastions were found in the selected compartments."
        : "Please select one or more compartments to view bastions."}
      icon={<Shield size={22} />}
    />
  )
}

function groupBastionsByCompartmentAndRegion(bastions: BastionResource[]): { compartmentId: string; regions: { region: string; bastions: BastionResource[] }[] }[] {
  const compartmentMap = new Map<string, Map<string, BastionResource[]>>()
  for (const bastion of bastions) {
    const compartmentId = bastion.compartmentId || "unknown-compartment"
    const region = bastion.region || "default"
    if (!compartmentMap.has(compartmentId)) {
      compartmentMap.set(compartmentId, new Map<string, BastionResource[]>())
    }
    const regionMap = compartmentMap.get(compartmentId)!
    if (!regionMap.has(region)) {
      regionMap.set(region, [])
    }
    regionMap.get(region)!.push(bastion)
  }
  return [...compartmentMap.entries()].map(([compartmentId, regions]) => ({
    compartmentId,
    regions: [...regions.entries()].map(([region, groupedBastions]) => ({ region, bastions: groupedBastions })),
  }))
}

function hasSshCommand(session: BastionSessionResource | null | undefined) {
  return getSshCommand(session).length > 0
}

function getSshCommand(session: BastionSessionResource | null | undefined) {
  const metadata = session?.sshMetadata
  if (!metadata || typeof metadata !== "object") {
    return ""
  }
  const directCommand = typeof metadata.command === "string" ? metadata.command.trim() : ""
  if (directCommand) {
    return directCommand
  }
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (/command/i.test(key) && typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return ""
}

function getSessionTypeLabel(session: BastionSessionResource | null | undefined) {
  const sessionType = session?.targetResourceDetails?.sessionType
  if (sessionType === "PORT_FORWARDING") {
    return "Port Forwarding"
  }
  if (sessionType === "MANAGED_SSH") {
    return "Managed SSH"
  }
  const details = session?.targetResourceDetails
  if (details?.targetResourcePort || details?.targetResourcePrivateIpAddress) {
    return "Port Forwarding"
  }
  if (details?.targetResourceOperatingSystemUserName) {
    return "Managed SSH"
  }
  return "Session"
}

function describeSessionTarget(session: BastionSessionResource | null | undefined) {
  const details = session?.targetResourceDetails
  if (!details) {
    return "Unknown target"
  }
  const targetPort = details.targetResourcePort ? String(details.targetResourcePort).trim() : ""
  const targetResourceId = details.targetResourceId ? String(details.targetResourceId).trim() : ""
  const targetPrivateIp = details.targetResourcePrivateIpAddress ? String(details.targetResourcePrivateIpAddress).trim() : ""
  const targetIpAddress = details.targetResourceIpAddress ? String(details.targetResourceIpAddress).trim() : ""
  if (targetResourceId && targetPort) {
    return `${targetResourceId}:${targetPort}`
  }
  return targetResourceId
    || (targetPrivateIp && targetPort ? `${targetPrivateIp}:${targetPort}` : targetPrivateIp)
    || [targetIpAddress, targetPort].filter(Boolean).join(":")
    || "Unknown target"
}

function formatSessionTtl(sessionTtlInSeconds: number | undefined) {
  if (!sessionTtlInSeconds || sessionTtlInSeconds <= 0) {
    return "Default policy"
  }
  if (sessionTtlInSeconds % 3600 === 0) {
    const hours = sessionTtlInSeconds / 3600
    return `${hours}h`
  }
  if (sessionTtlInSeconds % 60 === 0) {
    const minutes = sessionTtlInSeconds / 60
    return `${minutes}m`
  }
  return `${sessionTtlInSeconds}s`
}

function formatRecentActionAge(timestamp: number): string {
  const ageMs = Math.max(0, Date.now() - timestamp)
  if (ageMs < 5000) {
    return "just now"
  }
  return `${Math.round(ageMs / 1000)}s ago`
}
