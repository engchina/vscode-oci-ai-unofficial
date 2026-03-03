import { clsx } from "clsx"
import {
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    Database,
    Loader2,
    MonitorPlay,
    MonitorStop,
    PlayCircle,
    Plug,
    Save,
    Search,
    SquareTerminal,
    StopCircle,
    Trash2,
    Unplug,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { useScrollFlashTarget } from "../../hooks/useScrollFlashTarget"
import { ResourceServiceClient } from "../../services/grpc-client"
import type {
    DbSystemResource,
    ConnectDbSystemResponse,
    ExecuteAdbSqlResponse,
    LoadDbSystemConnectionResponse,
    OracleDbDiagnosticsResponse,
} from "../../services/types"
import { DEFAULT_SSH_USERNAME, loadSshConfig, saveSshConfig, type SshConfig } from "../../sshConfig"
import GuardrailDialog from "../common/GuardrailDialog"
import OracleDiagnosticsPanel from "../common/OracleDiagnosticsPanel"
import Button from "../ui/Button"
import CompartmentSelector from "../ui/CompartmentSelector"
import Input from "../ui/Input"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge, { LifecycleBadge } from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
import {
    DatabaseContextStrip,
    WorkbenchLoadingState,
    WorkbenchEmptyState,
    WorkbenchSection,
} from "../workbench/DatabaseWorkbenchChrome"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import WorkbenchActionInventoryCard from "../workbench/WorkbenchActionInventoryCard"
import {
    WorkbenchInventoryFilterEmpty,
    WorkbenchInventoryGroupHeading,
    WorkbenchInventoryRegionHeading,
    WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import {
    WorkbenchActionButton,
    WorkbenchDestructiveButton,
    WorkbenchDismissButton,
    WorkbenchGuardrailActionButton,
    WorkbenchInlineActionCluster,
    WorkbenchRevealButton,
    WorkbenchSelectButton,
} from "../workbench/WorkbenchActionButtons"
import {
    WorkbenchCompactFieldRow,
    WorkbenchCompactInput,
    WorkbenchInlineRadioOption,
    WorkbenchMicroOptionButton,
} from "../workbench/WorkbenchCompactControls"
import type { WorkbenchGuardrailState } from "../workbench/guardrail"
import { buildWorkbenchResourceGuardrailDetails, createStartResourceGuardrail, createStopResourceGuardrail } from "../workbench/guardrail"
import WorkbenchQueryResult from "../workbench/WorkbenchQueryResult"
import { WorkbenchRefreshButton, WorkbenchToolbarGroup, WorkbenchToolbarSpacer } from "../workbench/WorkbenchToolbar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs"

type ActionState = { id: string; action: "starting" | "stopping" } | null
type RecentActionState = {
    resourceId: string
    resourceName: string
    message: string
    timestamp: number
} | null

const TRANSITIONAL_STATES = new Set([
    "STARTING", "STOPPING", "PROVISIONING", "TERMINATING",
    "RESTARTING", "UPDATING", "UPGRADING", "BACKUP_IN_PROGRESS",
    "RESTORE_IN_PROGRESS", "SCALE_IN_PROGRESS", "MAINTENANCE_IN_PROGRESS",
])
const POLL_INTERVAL_MS = 5000

export default function DbSystemsView() {
    const { activeProfile, profilesConfig, tenancyOcid, dbSystemCompartmentIds, navigateToView } = useExtensionState()
    const { pendingSelection, setPendingSelection, setResource } = useWorkbenchInsight()
    const [dbSystems, setDbSystems] = useState<DbSystemResource[]>([])
    const [selectedDbId, setSelectedDbId] = useState("")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionState, setActionState] = useState<ActionState>(null)
    const [connectingId, setConnectingId] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    const [serviceName, setServiceName] = useState("")
    const [username, setUsername] = useState("SYSTEM")
    const [password, setPassword] = useState("")
    const [connectionId, setConnectionId] = useState("")
    const [connectionTarget, setConnectionTarget] = useState<Pick<ConnectDbSystemResponse, "dbSystemId" | "serviceName"> | null>(null)
    const [sql, setSql] = useState("SELECT SYSDATE AS CURRENT_TIME FROM DUAL")
    const [activeTab, setActiveTab] = useState("overview")
    const [sqlResult, setSqlResult] = useState<ExecuteAdbSqlResponse | null>(null)
    const [dbBusyAction, setDbBusyAction] = useState<"connect" | "disconnect" | "execute" | "save" | "delete" | null>(null)
    const [hasSavedProfile, setHasSavedProfile] = useState(false)
    const previousSelectedDbIdRef = useRef("")

    const [connectionStrings, setConnectionStrings] = useState<{ name: string, value: string }[]>([])
    const [loadingStrings, setLoadingStrings] = useState(false)
    const [diagnostics, setDiagnostics] = useState<OracleDbDiagnosticsResponse | null>(null)
    const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)

    // SSH configs
    const [sshConfig, setSshConfig] = useState<SshConfig>(loadSshConfig)
    const [sshUserOverrides, setSshUserOverrides] = useState<Record<string, string>>({})
    const [sshKeyOverrides, setSshKeyOverrides] = useState<Record<string, string>>({})
    const [sshSelectedIp, setSshSelectedIp] = useState<Record<string, string>>({})
    const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
    const [recentAction, setRecentAction] = useState<RecentActionState>(null)
    const [highlightedDbSystemId, setHighlightedDbSystemId] = useState<string | null>(null)
    const [showDbSystemWorkspace, setShowDbSystemWorkspace] = useState(false)
    const actionTimerRef = useRef<number | null>(null)
    const highlightTimerRef = useRef<number | null>(null)
    const dbSystemItemRefs = useRef(new Map<string, HTMLDivElement>())
    const diagnosticsFocus = useScrollFlashTarget()
    const errorFocus = useScrollFlashTarget()

    const selectedDatabase = useMemo(
        () => dbSystems.find((db) => db.id === selectedDbId) ?? null,
        [dbSystems, selectedDbId],
    )

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return dbSystems
        return dbSystems.filter(db => db.name.toLowerCase().includes(q) || db.id.toLowerCase().includes(q))
    }, [dbSystems, query])
    const grouped = useMemo(() => groupDbByCompartmentAndRegion(filtered), [filtered])
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
        () => dbSystemCompartmentIds.map((id) => id.trim()).filter((id) => id.length > 0),
        [dbSystemCompartmentIds],
    )

    useEffect(() => {
        if (!selectedDatabase) {
            setResource(null)
            return
        }

        setResource({
            view: "dbSystems",
            title: selectedDatabase.name,
            eyebrow: "Selected DB System",
            resourceId: selectedDatabase.id,
            badge: connectionId
                ? { label: "Connected", tone: "success" }
                : { label: selectedDatabase.lifecycleState, tone: toneFromLifecycleState(selectedDatabase.lifecycleState) },
            metrics: [
                { label: "Region", value: selectedDatabase.region || "default" },
                { label: "Lifecycle", value: selectedDatabase.lifecycleState },
                { label: "Connect String", value: serviceName || "Not set" },
                { label: "Node State", value: selectedDatabase.nodeLifecycleState || "-" },
            ],
            notes: [
                connectionTarget
                    ? `Connection target: ${connectionTarget.serviceName}`
                    : "No active SQL connection for this DB System.",
                connectionStrings.length > 0
                    ? `${connectionStrings.length} saved connect string candidates loaded.`
                    : "No connect strings loaded for the selected system yet.",
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
                    label: "Open SQL Workbench",
                    run: () => {
                        setPendingSelection({
                            view: "sqlWorkbench",
                            targetId: selectedDatabase.id,
                            targetType: "dbSystem",
                        })
                        navigateToView("sqlWorkbench")
                    },
                    variant: "secondary",
                },
            ],
        })

        return () => setResource(null)
    }, [connectionId, connectionStrings.length, connectionTarget, navigateToView, query, selectedDatabase, serviceName, setPendingSelection, setResource])

    useEffect(() => {
        if (pendingSelection?.view !== "dbSystems") {
            return
        }
        setSelectedDbId(pendingSelection.targetId)
        setShowDbSystemWorkspace(true)
        setPendingSelection(null)
    }, [pendingSelection, setPendingSelection])

    useEffect(() => {
        if (!selectedDatabase) {
            setShowDbSystemWorkspace(false)
        }
    }, [selectedDatabase])

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await ResourceServiceClient.listDbSystems()
            const items = res.dbSystems ?? []
            setDbSystems(items)
            if (!selectedDbId && items.length > 0) {
                setSelectedDbId(items[0].id)
            }
            if (selectedDbId && !items.some((db) => db.id === selectedDbId)) {
                setSelectedDbId(items[0]?.id ?? "")
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [selectedDbId, selectedCompartmentIds])

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
        if (!highlightedDbSystemId) {
            return
        }
        highlightTimerRef.current = window.setTimeout(() => {
            highlightTimerRef.current = null
            setHighlightedDbSystemId(null)
        }, 2200)
        return () => {
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
                highlightTimerRef.current = null
            }
        }
    }, [highlightedDbSystemId])

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

    const isPolling = dbSystems.some(db =>
        TRANSITIONAL_STATES.has(db.lifecycleState) ||
        (db.nodeLifecycleState != null && TRANSITIONAL_STATES.has(db.nodeLifecycleState))
    )
    useEffect(() => {
        if (!isPolling) return
        const timer = setInterval(load, POLL_INTERVAL_MS)
        return () => clearInterval(timer)
    }, [isPolling, load])

    useEffect(() => {
        if (!highlightedDbSystemId || !filtered.some((item) => item.id === highlightedDbSystemId)) {
            return
        }
        const frameId = window.requestAnimationFrame(() => {
            dbSystemItemRefs.current.get(highlightedDbSystemId)?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            })
        })
        return () => window.cancelAnimationFrame(frameId)
    }, [filtered, highlightedDbSystemId])

    const handleStart = useCallback(
        async (id: string, region?: string) => {
            setActionState({ id, action: "starting" })
            try {
                await ResourceServiceClient.startDbSystem(id, region)
                await load()
                const dbSystem = dbSystems.find((item) => item.id === id)
                setSelectedDbId(id)
                setHighlightedDbSystemId(id)
                setRecentAction({
                    resourceId: id,
                    resourceName: dbSystem?.name ?? id,
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
                await ResourceServiceClient.stopDbSystem(id, region)
                await load()
                const dbSystem = dbSystems.find((item) => item.id === id)
                setSelectedDbId(id)
                setHighlightedDbSystemId(id)
                setRecentAction({
                    resourceId: id,
                    resourceName: dbSystem?.name ?? id,
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

    const handleSshConnect = useCallback(
        async (sys: DbSystemResource) => {
            const host = sshSelectedIp[sys.id] || sys.publicIp || sys.privateIp || ""
            const defaultUsername = sshConfig.username.trim() || DEFAULT_SSH_USERNAME
            const username = sshUserOverrides[sys.id]?.trim() || defaultUsername
            if (!host) {
                setError(`No node IP found for DB System "${sys.name}".`)
                return
            }
            if (!username) {
                setError("SSH username is required before connecting.")
                return
            }

            const effectiveKeyPath =
                sshKeyOverrides[sys.id]?.trim() || sshConfig.privateKeyPath.trim() || undefined

            setConnectingId(sys.id)
            try {
                await ResourceServiceClient.connectDbSystemSsh({
                    dbSystemId: sys.id,
                    dbSystemName: sys.name,
                    host,
                    username,
                    port: sshConfig.port,
                    privateKeyPath: effectiveKeyPath,
                    disableHostKeyChecking: sshConfig.disableHostKeyChecking,
                })
                setSelectedDbId(sys.id)
                setHighlightedDbSystemId(sys.id)
                setRecentAction({
                    resourceId: sys.id,
                    resourceName: sys.name,
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

    const handleConnect = useCallback(async () => {
        if (!selectedDatabase?.id) {
            setError("Please select a database first.")
            return
        }
        setError(null)
        setSqlResult(null)
        setDbBusyAction("connect")
        try {
            const response = await ResourceServiceClient.connectDbSystem({
                dbSystemId: selectedDatabase.id,
                username,
                password,
                serviceName,
            })
            setConnectionId(response.connectionId)
            setConnectionTarget({
                dbSystemId: response.dbSystemId,
                serviceName: response.serviceName,
            })
            setHighlightedDbSystemId(selectedDatabase.id)
            setRecentAction({
                resourceId: selectedDatabase.id,
                resourceName: selectedDatabase.name,
                message: "Connected to",
                timestamp: Date.now(),
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDbBusyAction(null)
        }
    }, [password, selectedDatabase, serviceName, username])

    const disconnectConnection = useCallback(async (id: string) => {
        if (!id) return
        await ResourceServiceClient.disconnectDbSystem(id)
    }, [])

    const handleDisconnect = useCallback(async () => {
        if (!connectionId) return
        setError(null)
        setDbBusyAction("disconnect")
        try {
            await disconnectConnection(connectionId)
            if (selectedDatabase) {
                setHighlightedDbSystemId(selectedDatabase.id)
                setRecentAction({
                    resourceId: selectedDatabase.id,
                    resourceName: selectedDatabase.name,
                    message: "Disconnected from",
                    timestamp: Date.now(),
                })
            }
            setConnectionId("")
            setConnectionTarget(null)
            setSqlResult(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDbBusyAction(null)
        }
    }, [connectionId, disconnectConnection])

    const loadSavedProfile = useCallback(async (dbId: string) => {
        try {
            const saved = await ResourceServiceClient.loadDbSystemConnection(dbId) as LoadDbSystemConnectionResponse | Record<string, never>
            if (saved && "dbSystemId" in saved && saved.dbSystemId) {
                setUsername(saved.username || "SYSTEM")
                setPassword(saved.password || "")
                setServiceName(saved.serviceName || "")
                setHasSavedProfile(true)
                return
            }
        } catch {
            // Ignore load errors - just start with empty fields
        }
        setHasSavedProfile(false)
    }, [])

    const fetchConnectionStrings = useCallback(async (dbId: string, compartmentId: string, region?: string, publicIp?: string) => {
        setLoadingStrings(true)
        setConnectionStrings([])
        try {
            const res = await ResourceServiceClient.getDbSystemConnectionStrings({ dbSystemId: dbId, compartmentId, region, publicIp })
            setConnectionStrings(res.connectionStrings || [])
        } catch {
            // ignore
        } finally {
            setLoadingStrings(false)
        }
    }, [])

    useEffect(() => {
        const previous = previousSelectedDbIdRef.current
        if (!selectedDbId) {
            previousSelectedDbIdRef.current = selectedDbId
            return
        }
        if (previous && previous !== selectedDbId) {
            const activeConnectionId = connectionId
            setConnectionId("")
            setConnectionTarget(null)
            setSqlResult(null)

            const sys = dbSystems.find(d => d.id === selectedDbId)
            setServiceName("")
            setUsername("SYSTEM")
            setPassword("")
            setHasSavedProfile(false)

            if (activeConnectionId) {
                void disconnectConnection(activeConnectionId)
            }
            void loadSavedProfile(selectedDbId)
            if (sys && sys.compartmentId) {
                void fetchConnectionStrings(selectedDbId, sys.compartmentId, sys.region, sys.publicIp || undefined)
            }
        } else if (!previous) {
            const sys = dbSystems.find(d => d.id === selectedDbId)
            void loadSavedProfile(selectedDbId)
            if (sys && sys.compartmentId) {
                void fetchConnectionStrings(selectedDbId, sys.compartmentId, sys.region, sys.publicIp || undefined)
            }
        }
        previousSelectedDbIdRef.current = selectedDbId
    }, [connectionId, disconnectConnection, loadSavedProfile, selectedDbId, dbSystems, fetchConnectionStrings])

    useEffect(() => {
        return () => {
            if (!connectionId) return
            void disconnectConnection(connectionId)
        }
    }, [connectionId, disconnectConnection])

    const handleExecuteSql = useCallback(async () => {
        if (!connectionId) {
            setError("Please connect first.")
            return
        }
        setError(null)
        setDbBusyAction("execute")
        try {
            const response = await ResourceServiceClient.executeDbSystemSql({
                connectionId,
                sql,
            })
            setSqlResult(response)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDbBusyAction(null)
        }
    }, [connectionId, sql])

    const handleSaveConnection = useCallback(async () => {
        if (!selectedDatabase?.id) return
        setError(null)
        setDbBusyAction("save")
        try {
            await ResourceServiceClient.saveDbSystemConnection({
                dbSystemId: selectedDatabase.id,
                username,
                password,
                serviceName,
            })
            setHasSavedProfile(true)
            if (selectedDatabase) {
                setHighlightedDbSystemId(selectedDatabase.id)
                setRecentAction({
                    resourceId: selectedDatabase.id,
                    resourceName: selectedDatabase.name,
                    message: "Saved connection profile for",
                    timestamp: Date.now(),
                })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDbBusyAction(null)
        }
    }, [password, selectedDatabase, serviceName, username])

    const handleDeleteConnection = useCallback(async () => {
        if (!selectedDatabase?.id) return
        setError(null)
        setDbBusyAction("delete")
        try {
            await ResourceServiceClient.deleteDbSystemConnection(selectedDatabase.id)
            setHasSavedProfile(false)
            setHighlightedDbSystemId(selectedDatabase.id)
            setRecentAction({
                resourceId: selectedDatabase.id,
                resourceName: selectedDatabase.name,
                message: "Deleted saved profile for",
                timestamp: Date.now(),
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDbBusyAction(null)
        }
    }, [selectedDatabase])

    useEffect(() => {
        diagnosticsFocus.consumePendingFocus(!loadingDiagnostics && Boolean(diagnostics) && activeTab === "overview")
    }, [activeTab, diagnostics, diagnosticsFocus, loadingDiagnostics])

    useEffect(() => {
        errorFocus.consumePendingFocus(!loadingDiagnostics && Boolean(error) && activeTab === "overview")
    }, [activeTab, error, errorFocus, loadingDiagnostics])

    const handleDiagnostics = useCallback(async () => {
        setError(null)
        setActiveTab("overview")
        diagnosticsFocus.requestFocus()
        errorFocus.requestFocus()
        setLoadingDiagnostics(true)
        try {
            const response = await ResourceServiceClient.getOracleDbDiagnostics()
            setDiagnostics(response)
        } catch (err) {
            diagnosticsFocus.cancelFocus()
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoadingDiagnostics(false)
        }
    }, [diagnosticsFocus, errorFocus])

    const revealDbSystem = useCallback((dbSystemId: string) => {
        setQuery("")
        setSelectedDbId(dbSystemId)
        setActiveTab("overview")
        setShowDbSystemWorkspace(false)
        setHighlightedDbSystemId(dbSystemId)
    }, [])

    return (
        <FeaturePageLayout
            title="DB Systems"
        description="Browse DB Systems, manage related operations, and connect over SQL with SSH context nearby."
        icon={<Database size={16} />}
            status={isPolling ? <StatusBadge label="Auto-refreshing" tone="warning" size="compact" className="animate-pulse" /> : undefined}
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
                    <CompartmentSelector featureKey="dbSystem" multiple />
                    {dbSystems.length > 0 && (
                        <FeatureSearchInput
                            value={query}
                            onChange={setQuery}
                            placeholder="Filter DB Systems..."
                        />
                    )}
                </div>
            )}
        >
            <div className="flex h-full min-h-0 flex-col px-2 py-2">
                {error && (
                    <div
                        ref={errorFocus.targetRef}
                        className={clsx(
                            "rounded-md transition-all duration-500",
                            errorFocus.isFlashing && "bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--vscode-errorForeground)_40%,transparent)]"
                        )}
                    >
                        <InlineNotice tone="danger" size="md" icon={<AlertCircle size={13} />} className="mb-2">
                            {error}
                        </InlineNotice>
                    </div>
                )}

                {recentAction && (
                    <InlineNotice
                        tone="info"
                        icon={<CheckCircle2 size={14} className="text-[var(--vscode-testing-iconPassed)]" />}
                        className="mb-2"
                        actions={(
                            <>
                                <WorkbenchRevealButton onClick={() => revealDbSystem(recentAction.resourceId)} title="Show this DB System in the list" label="Show DB System" />
                                <WorkbenchDismissButton onClick={() => setRecentAction(null)} title="Dismiss" />
                            </>
                        )}
                    >
                        <div className="min-w-0">
                            {recentAction.message} <span className="text-[var(--vscode-foreground)]">{recentAction.resourceName}</span> {formatRecentActionAge(recentAction.timestamp)}
                        </div>
                    </InlineNotice>
                )}

                {loading && dbSystems.length === 0 ? (
                    <WorkbenchLoadingState
                        label="Loading DB Systems..."
                        className="min-h-[140px] py-4"
                    />
                ) : dbSystems.length === 0 ? (
                    <div className="flex flex-1">
                        <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
                    </div>
                ) : (
                    <div className="min-h-0 flex-1">
                        {showDbSystemWorkspace && selectedDatabase ? (
                            <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                                <div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-panel-border)] px-3 py-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowDbSystemWorkspace(false)}
                                            className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                                            title="Back to DB Systems"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                        <div className="min-w-0">
                                            <div className="truncate text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">
                                                DB System
                                            </div>
                                            <div className="truncate text-[10px] text-description">{selectedDatabase.name}</div>
                                        </div>
                                    </div>
                                    <StatusBadge
                                        label={connectionId ? "Connected" : "Disconnected"}
                                        tone={connectionId ? "success" : "neutral"}
                                        size="compact"
                                    />
                                </div>

                                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                                    {connectionTarget && (
                                        <DatabaseContextStrip
                                            items={[
                                                { label: "DB", value: connectionTarget.dbSystemId },
                                                { label: "Service / Connect String", value: connectionTarget.serviceName },
                                            ]}
                                        />
                                    )}

                                    <div className="flex-1 min-h-0 flex flex-col">
                                        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0">
                                            <TabsList>
                                                <TabsTrigger value="overview">Overview</TabsTrigger>
                                                <TabsTrigger value="connection">Connection</TabsTrigger>
                                                <TabsTrigger value="query">Query</TabsTrigger>
                                            </TabsList>
                                            <TabsContent value="overview" className="flex-1 overflow-auto pt-1.5">
                                                <div
                                                    ref={diagnosticsFocus.targetRef}
                                                    className={clsx(
                                                        "rounded-md transition-all duration-500",
                                                        diagnosticsFocus.isFlashing && "bg-[color-mix(in_srgb,var(--vscode-focusBorder)_12%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--vscode-focusBorder)_55%,transparent)]"
                                                    )}
                                                >
                                                <OracleDiagnosticsPanel diagnostics={diagnostics} />
                                                </div>
                                            </TabsContent>
                                            <TabsContent value="connection" className="flex-1 overflow-auto pt-1.5">
                                                <WorkbenchSection
                                                    title="Connection"
                                                    subtitle="Pick a connect string, keep saved credentials nearby, and maintain the active DB session."
                                                >
                                                    <div className="grid gap-2 sm:grid-cols-2">
                                                        <Input
                                                            label="Connect String / Service Name"
                                                            value={serviceName}
                                                            onChange={e => setServiceName(e.target.value)}
                                                            placeholder="e.g. 129.146.x.x:1521/<service_name>.<db_domain>"
                                                            list={`db-strings-${selectedDbId}`}
                                                        />
                                                        {connectionStrings.length > 0 && (
                                                            <datalist id={`db-strings-${selectedDbId}`}>
                                                                {connectionStrings.map(cs => (
                                                                    <option key={cs.name} value={cs.value}>{cs.name}</option>
                                                                ))}
                                                            </datalist>
                                                        )}
                                                        <div className="col-span-1 sm:col-span-2 flex flex-col gap-1 -mt-1">
                                                            {loadingStrings && <span className="text-[10px] text-description animate-pulse">Fetching connection strings...</span>}
                                                            {!loadingStrings && connectionStrings.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {connectionStrings.map(cs => (
                                                                        <WorkbenchMicroOptionButton
                                                                            key={cs.name}
                                                                            onClick={() => setServiceName(cs.value)}
                                                                            title={cs.value}
                                                                        >
                                                                            {cs.name}
                                                                        </WorkbenchMicroOptionButton>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="grid gap-2 sm:grid-cols-2">
                                                        <Input
                                                            label="Username"
                                                            value={username}
                                                            onChange={e => setUsername(e.target.value)}
                                                            placeholder="SYSTEM"
                                                        />
                                                        <Input
                                                            type="password"
                                                            label="Password"
                                                            value={password}
                                                            onChange={e => setPassword(e.target.value)}
                                                            placeholder="Database password"
                                                        />
                                                    </div>

                                                    <WorkbenchToolbarGroup>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            className="gap-1.5"
                                                            onClick={handleConnect}
                                                            disabled={
                                                                dbBusyAction !== null ||
                                                                Boolean(connectionId) ||
                                                                !selectedDbId ||
                                                                !username.trim() ||
                                                                !password ||
                                                                !serviceName.trim()
                                                            }
                                                        >
                                                            {dbBusyAction === "connect" ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                                                            Connect
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            className="gap-1.5"
                                                            onClick={handleDisconnect}
                                                            disabled={dbBusyAction !== null || !connectionId}
                                                        >
                                                            {dbBusyAction === "disconnect" ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                                                            Disconnect
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="secondary"
                                                            className="gap-1.5"
                                                            onClick={handleDiagnostics}
                                                            disabled={loadingDiagnostics}
                                                        >
                                                            {loadingDiagnostics ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                                                            Connection Diagnostic
                                                        </Button>
                                                        <WorkbenchToolbarSpacer>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="secondary"
                                                                className="gap-1.5"
                                                                onClick={handleSaveConnection}
                                                                disabled={
                                                                    dbBusyAction !== null ||
                                                                    !selectedDbId ||
                                                                    !username.trim() ||
                                                                    !serviceName.trim()
                                                                }
                                                            >
                                                                {dbBusyAction === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                                                {hasSavedProfile ? "Saved" : "Save"}
                                                            </Button>
                                                            {hasSavedProfile && (
                                                                <WorkbenchDestructiveButton
                                                                    type="button"
                                                                    onClick={handleDeleteConnection}
                                                                    disabled={dbBusyAction !== null}
                                                                >
                                                                    {dbBusyAction === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                                    Delete
                                                                </WorkbenchDestructiveButton>
                                                            )}
                                                        </WorkbenchToolbarSpacer>
                                                    </WorkbenchToolbarGroup>
                                                </WorkbenchSection>
                                            </TabsContent>
                                            <TabsContent value="query" className="flex-1 overflow-auto pt-1.5">
                                                <WorkbenchSection
                                                    title="SQL Runner"
                                                    subtitle="Run statements against the connected DB System and inspect the returned rows."
                                                >
                                                    <Textarea
                                                        label="SQL"
                                                        value={sql}
                                                        onChange={e => setSql(e.target.value)}
                                                        className="min-h-[140px] font-mono text-xs"
                                                        placeholder="SELECT * FROM your_table FETCH FIRST 20 ROWS ONLY"
                                                    />
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        className="w-fit gap-1.5"
                                                        onClick={handleExecuteSql}
                                                        disabled={dbBusyAction !== null || !connectionId || !sql.trim()}
                                                    >
                                                        {dbBusyAction === "execute" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                                                        Execute SQL
                                                    </Button>

                                                    {sqlResult ? (
                                                        <WorkbenchQueryResult result={sqlResult} />
                                                    ) : (
                                                        <WorkbenchEmptyState
                                                            title="No query output yet"
                                                            description="Connect to the selected DB System and execute a statement to populate this area."
                                                        />
                                                    )}
                                                </WorkbenchSection>
                                            </TabsContent>
                                        </Tabs>
                                    </div>
                                </div>
                            </section>
                        ) : (
                            <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                                <div className="h-full overflow-y-auto p-2">
                                    <div className="flex flex-col gap-2">
                                        <WorkbenchInventorySummary
                                            label="System inventory"
                                            count={filtered.length === dbSystems.length
                                                ? `${dbSystems.length} DB System${dbSystems.length !== 1 ? "s" : ""}`
                                                : `${filtered.length} of ${dbSystems.length} DB Systems`}
                                            description="Select a DB System to manage lifecycle, SSH access, and SQL connectivity."
                                        />

                                        {filtered.length === 0 ? (
                                            <WorkbenchInventoryFilterEmpty message="No DB Systems match your filter." />
                                        ) : (
                                            grouped.map((compartmentGroup) => (
                                                <div key={compartmentGroup.compartmentId} className="mb-1">
                                                    <WorkbenchInventoryGroupHeading>
                                                        {compartmentNameById.get(compartmentGroup.compartmentId) ?? compartmentGroup.compartmentId}
                                                    </WorkbenchInventoryGroupHeading>
                                                    <div className="flex flex-col gap-2">
                                                        {compartmentGroup.regions.map((regionGroup) => (
                                                            <div key={`${compartmentGroup.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                                                                <WorkbenchInventoryRegionHeading>
                                                                    {regionGroup.region}
                                                                </WorkbenchInventoryRegionHeading>
                                                                {regionGroup.dbSystems.map((db) => (
                                                                    <DatabaseCard
                                                                        key={`${db.id}-${db.region ?? "default"}`}
                                                                        dbSystem={db}
                                                                        selected={db.id === selectedDbId}
                                                                        highlighted={highlightedDbSystemId === db.id}
                                                                        onRegisterRef={(node) => {
                                                                            if (node) {
                                                                                dbSystemItemRefs.current.set(db.id, node)
                                                                            } else {
                                                                                dbSystemItemRefs.current.delete(db.id)
                                                                            }
                                                                        }}
                                                                        actionState={actionState}
                                                                        connectingId={connectingId}
                                                                        sshConfig={sshConfig}
                                                                        sshUserOverride={sshUserOverrides[db.id] || ""}
                                                                        sshKeyOverride={sshKeyOverrides[db.id] || ""}
                                                                        selectedIp={sshSelectedIp[db.id] || db.publicIp || db.privateIp || ""}
                                                                        onStart={handleStart}
                                                                        onStop={handleStop}
                                                                        onRequestGuardrail={setGuardrail}
                                                                        onSelect={(id) => {
                                                                            setSelectedDbId(id)
                                                                            setShowDbSystemWorkspace(true)
                                                                        }}
                                                                        onConnectSsh={handleSshConnect}
                                                                        onChangeSshSelectedIp={(id, ip) => setSshSelectedIp((prev) => ({ ...prev, [id]: ip }))}
                                                                        onChangeSshUserOverride={(id, username) => setSshUserOverrides((prev) => ({ ...prev, [id]: username }))}
                                                                        onChangeSshKeyOverride={(id, keyPath) => setSshKeyOverrides((prev) => ({ ...prev, [id]: keyPath }))}
                                                                    />
                                                                ))}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </section>
                        )}
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

function DatabaseCard({
    dbSystem,
    selected,
    highlighted,
    onRegisterRef,
    actionState,
    connectingId,
    sshConfig,
    sshUserOverride,
    sshKeyOverride,
    selectedIp,
    onStart,
    onStop,
    onRequestGuardrail,
    onSelect,
    onConnectSsh,
    onChangeSshSelectedIp,
    onChangeSshUserOverride,
    onChangeSshKeyOverride,
}: {
    dbSystem: DbSystemResource
    selected: boolean
    highlighted: boolean
    onRegisterRef: (node: HTMLDivElement | null) => void
    actionState: ActionState
    connectingId: string | null
    sshConfig: SshConfig
    sshUserOverride: string
    sshKeyOverride: string
    selectedIp: string
    onStart: (id: string, region?: string) => void
    onStop: (id: string, region?: string) => void
    onRequestGuardrail: (value: WorkbenchGuardrailState) => void
    onSelect: (id: string) => void
    onConnectSsh: (sys: DbSystemResource) => void
    onChangeSshSelectedIp: (id: string, ip: string) => void
    onChangeSshUserOverride: (id: string, u: string) => void
    onChangeSshKeyOverride: (id: string, k: string) => void
}) {
    const isActing = actionState?.id === dbSystem.id
    const effectiveState = dbSystem.nodeLifecycleState ?? dbSystem.lifecycleState
    const isAvailable = effectiveState === "AVAILABLE"
    const isTerminal = effectiveState === "TERMINATED" || effectiveState === "FAILED"
    const isConnecting = connectingId === dbSystem.id

    const host = selectedIp
    const defaultUsername = sshConfig.username.trim() || DEFAULT_SSH_USERNAME

    return (
        <WorkbenchActionInventoryCard
            cardRef={onRegisterRef}
            title={dbSystem.name}
            subtitle={dbSystem.id}
            selected={selected}
            highlighted={highlighted}
            onSelect={() => onSelect(dbSystem.id)}
            trailing={(
                <div className="flex shrink-0 flex-col items-end gap-1">
                    <LifecycleBadge state={effectiveState} size="compact" />
                    {dbSystem.nodeLifecycleState && dbSystem.nodeLifecycleState !== dbSystem.lifecycleState && (
                        <span className="text-[9px] text-description">
                            System: {dbSystem.lifecycleState} / Node: {dbSystem.nodeLifecycleState}
                        </span>
                    )}
                </div>
            )}
            meta={(
                <>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="text-[11px] text-description font-semibold">IP:</span>
                        {dbSystem.publicIp && (
                            <WorkbenchInlineRadioOption
                                name={`ip-${dbSystem.id}`}
                                checked={selectedIp === dbSystem.publicIp}
                                onChange={() => onChangeSshSelectedIp(dbSystem.id, dbSystem.publicIp!)}
                            >
                                {dbSystem.publicIp} (Public)
                            </WorkbenchInlineRadioOption>
                        )}
                        {dbSystem.privateIp && (
                            <WorkbenchInlineRadioOption
                                name={`ip-${dbSystem.id}`}
                                checked={selectedIp === dbSystem.privateIp}
                                onChange={() => onChangeSshSelectedIp(dbSystem.id, dbSystem.privateIp!)}
                            >
                                {dbSystem.privateIp} (Private)
                            </WorkbenchInlineRadioOption>
                        )}
                        {!dbSystem.publicIp && !dbSystem.privateIp && (
                            <span className="text-[11px] text-description">None</span>
                        )}
                    </div>

                    <WorkbenchCompactFieldRow className="mt-2 max-w-[320px]" label="SSH User">
                        <WorkbenchCompactInput
                            type="text"
                            value={sshUserOverride}
                            onChange={(e) => onChangeSshUserOverride(dbSystem.id, e.target.value)}
                            placeholder={defaultUsername}
                            className="rounded-md"
                        />
                    </WorkbenchCompactFieldRow>
                    <WorkbenchCompactFieldRow className="mt-1 max-w-[320px]" label="Identity">
                        <WorkbenchCompactInput
                            type="text"
                            value={sshKeyOverride}
                            onChange={(e) => onChangeSshKeyOverride(dbSystem.id, e.target.value)}
                            placeholder={sshConfig.privateKeyPath.trim() || "~/.ssh/id_rsa"}
                            className="rounded-md"
                        />
                    </WorkbenchCompactFieldRow>
                </>
            )}
            actions={(
                <WorkbenchInlineActionCluster>
                    <WorkbenchSelectButton selected={selected} onClick={() => onSelect(dbSystem.id)} />
                    <WorkbenchGuardrailActionButton
                        disabled={isActing || isAvailable || isTerminal}
                        guardrail={createStartResourceGuardrail({
                            resourceKind: "db-system",
                            details: buildWorkbenchResourceGuardrailDetails({
                                resourceLabel: "DB System",
                                resourceName: dbSystem.name,
                                region: dbSystem.region || "default",
                                extras: [
                                    { label: "Target IP", value: host || "None" },
                                ],
                            }),
                            onConfirm: async () => {
                                await onStart(dbSystem.id, dbSystem.region)
                            },
                        })}
                        onRequestGuardrail={onRequestGuardrail}
                        busy={isActing && actionState?.action === "starting"}
                        idleIcon={<PlayCircle size={12} />}
                        label="Start"
                    />
                    <WorkbenchGuardrailActionButton
                        disabled={isActing || !isAvailable}
                        guardrail={createStopResourceGuardrail({
                            resourceKind: "db-system",
                            details: buildWorkbenchResourceGuardrailDetails({
                                resourceLabel: "DB System",
                                resourceName: dbSystem.name,
                                region: dbSystem.region || "default",
                                extras: [
                                    { label: "Target IP", value: host || "None" },
                                ],
                            }),
                            onConfirm: async () => {
                                await onStop(dbSystem.id, dbSystem.region)
                            },
                        })}
                        onRequestGuardrail={onRequestGuardrail}
                        busy={isActing && actionState?.action === "stopping"}
                        idleIcon={<StopCircle size={12} />}
                        label="Stop"
                    />
                    <WorkbenchActionButton
                        disabled={!isAvailable || !host}
                        onClick={() => onConnectSsh(dbSystem)}
                    >
                        {isConnecting ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                        SSH Connect
                    </WorkbenchActionButton>
                </WorkbenchInlineActionCluster>
            )}
        />
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
            title={hasSelectedCompartments ? "No DB Systems Found" : "No Compartment Selected"}
            description={hasSelectedCompartments
                ? "No DB Systems were found in the selected compartments."
                : "Please select one or more compartments."}
            icon={<Database size={24} className="opacity-70" />}
        />
    )
}

function groupDbByCompartmentAndRegion(dbs: DbSystemResource[]): { compartmentId: string; regions: { region: string; dbSystems: DbSystemResource[] }[] }[] {
    const compartmentMap = new Map<string, Map<string, DbSystemResource[]>>()
    for (const db of dbs) {
        const compartmentId = db.compartmentId || "unknown-compartment"
        const region = db.region || "default"
        if (!compartmentMap.has(compartmentId)) {
            compartmentMap.set(compartmentId, new Map<string, DbSystemResource[]>())
        }
        const regionMap = compartmentMap.get(compartmentId)!
        if (!regionMap.has(region)) {
            regionMap.set(region, [])
        }
        regionMap.get(region)!.push(db)
    }
    return [...compartmentMap.entries()].map(([compartmentId, regions]) => ({
        compartmentId,
        regions: [...regions.entries()].map(([region, groupedDbs]) => ({ region, dbSystems: groupedDbs })),
    }))
}
