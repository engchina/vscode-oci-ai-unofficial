import { clsx } from "clsx"
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Database,
  Download,
  Loader2,
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
  AdbResource,
  ConnectAdbResponse,
  ExecuteAdbSqlResponse,
  LoadAdbConnectionResponse,
  OracleDbDiagnosticsResponse,
} from "../../services/types"
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

export default function AdbView() {
  const { activeProfile, profilesConfig, tenancyOcid, adbCompartmentIds, navigateToView } = useExtensionState()
  const { pendingSelection, setPendingSelection, setResource } = useWorkbenchInsight()
  const [databases, setDatabases] = useState<AdbResource[]>([])
  const [selectedAdbId, setSelectedAdbId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionState, setActionState] = useState<ActionState>(null)
  const [query, setQuery] = useState("")

  const [walletPassword, setWalletPassword] = useState("")
  const [walletPath, setWalletPath] = useState("")
  const [serviceNames, setServiceNames] = useState<string[]>([])
  const [serviceName, setServiceName] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [connectionId, setConnectionId] = useState("")
  const [connectionTarget, setConnectionTarget] = useState<Pick<ConnectAdbResponse, "autonomousDatabaseId" | "serviceName" | "walletPath"> | null>(null)
  const [sql, setSql] = useState("SELECT SYSDATE AS CURRENT_TIME FROM DUAL")
  const [activeTab, setActiveTab] = useState("overview")
  const [sqlResult, setSqlResult] = useState<ExecuteAdbSqlResponse | null>(null)
  const [adbBusyAction, setAdbBusyAction] = useState<"wallet" | "connect" | "disconnect" | "execute" | "save" | "delete" | null>(null)
  const [hasSavedProfile, setHasSavedProfile] = useState(false)
  const [diagnostics, setDiagnostics] = useState<OracleDbDiagnosticsResponse | null>(null)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)
  const previousSelectedAdbIdRef = useRef("")
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [highlightedDatabaseId, setHighlightedDatabaseId] = useState<string | null>(null)
  const [showDatabaseWorkspace, setShowDatabaseWorkspace] = useState(false)
  const actionTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const databaseItemRefs = useRef(new Map<string, HTMLDivElement>())
  const diagnosticsFocus = useScrollFlashTarget()
  const errorFocus = useScrollFlashTarget()

  const selectedDatabase = useMemo(
    () => databases.find((db) => db.id === selectedAdbId) ?? null,
    [databases, selectedAdbId],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return databases
    return databases.filter(db => db.name.toLowerCase().includes(q) || db.id.toLowerCase().includes(q))
  }, [databases, query])
  const grouped = useMemo(() => groupAdbByCompartmentAndRegion(filtered), [filtered])
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
    () => adbCompartmentIds.map((id) => id.trim()).filter((id) => id.length > 0),
    [adbCompartmentIds],
  )

  useEffect(() => {
    if (!selectedDatabase) {
      setResource(null)
      return
    }

    setResource({
      view: "adb",
      title: selectedDatabase.name,
      eyebrow: "Selected Autonomous Database",
      resourceId: selectedDatabase.id,
      badge: connectionId
        ? { label: "Connected", tone: "success" }
        : { label: selectedDatabase.lifecycleState, tone: toneFromLifecycleState(selectedDatabase.lifecycleState) },
      metrics: [
        { label: "Region", value: selectedDatabase.region || "default" },
        { label: "Lifecycle", value: selectedDatabase.lifecycleState },
        { label: "Service", value: serviceName || "Not set" },
        { label: "Wallet", value: walletPath || "Not downloaded" },
      ],
      notes: [
        connectionTarget
          ? `Connection target: ${connectionTarget.serviceName}`
          : "No active SQL connection for this database.",
        hasSavedProfile ? "A saved connection profile is available." : "Connection profile is not saved yet.",
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
              targetType: "adb",
            })
            navigateToView("sqlWorkbench")
          },
          variant: "secondary",
        },
      ],
    })

    return () => setResource(null)
  }, [connectionId, connectionTarget, hasSavedProfile, navigateToView, query, selectedDatabase, serviceName, setPendingSelection, setResource, walletPath])

  useEffect(() => {
    if (pendingSelection?.view !== "adb") {
      return
    }
    setSelectedAdbId(pendingSelection.targetId)
    setShowDatabaseWorkspace(true)
    setPendingSelection(null)
  }, [pendingSelection, setPendingSelection])

  useEffect(() => {
    if (!selectedDatabase) {
      setShowDatabaseWorkspace(false)
    }
  }, [selectedDatabase])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (selectedCompartmentIds.length === 0) {
      setDatabases([])
      setSelectedAdbId("")
      setLoading(false)
      return
    }
    try {
      const res = await ResourceServiceClient.listAdb()
      const items = res.databases ?? []
      setDatabases(items)
      if (!selectedAdbId && items.length > 0) {
        setSelectedAdbId(items[0].id)
      }
      if (selectedAdbId && !items.some((db) => db.id === selectedAdbId)) {
        setSelectedAdbId(items[0]?.id ?? "")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedAdbId, selectedCompartmentIds])

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
    if (!highlightedDatabaseId) {
      return
    }
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null
      setHighlightedDatabaseId(null)
    }, 2200)
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [highlightedDatabaseId])

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

  const isPolling = databases.some(db => TRANSITIONAL_STATES.has(db.lifecycleState))
  useEffect(() => {
    if (!isPolling) return
    const timer = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isPolling, load])

  useEffect(() => {
    if (!highlightedDatabaseId || !filtered.some((item) => item.id === highlightedDatabaseId)) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      databaseItemRefs.current.get(highlightedDatabaseId)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [filtered, highlightedDatabaseId])

  const handleStart = useCallback(
    async (id: string, region?: string) => {
      setActionState({ id, action: "starting" })
      try {
        await ResourceServiceClient.startAdb(id, region)
        await load()
        const database = databases.find((item) => item.id === id)
        setSelectedAdbId(id)
        setHighlightedDatabaseId(id)
        setRecentAction({
          resourceId: id,
          resourceName: database?.name ?? id,
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
        await ResourceServiceClient.stopAdb(id, region)
        await load()
        const database = databases.find((item) => item.id === id)
        setSelectedAdbId(id)
        setHighlightedDatabaseId(id)
        setRecentAction({
          resourceId: id,
          resourceName: database?.name ?? id,
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

  const handleDownloadWallet = useCallback(async () => {
    if (!selectedDatabase?.id) {
      setError("Please select a database first.")
      return
    }
    setError(null)
    setAdbBusyAction("wallet")
    try {
      const response = await ResourceServiceClient.downloadAdbWallet({
        autonomousDatabaseId: selectedDatabase.id,
        walletPassword,
        region: selectedDatabase.region,
      })
      setWalletPath(response.walletPath)
      setServiceNames(response.serviceNames ?? [])
      if ((response.serviceNames ?? []).length > 0) {
        setServiceName(response.serviceNames[0])
      }
      if (selectedDatabase) {
        setHighlightedDatabaseId(selectedDatabase.id)
        setRecentAction({
          resourceId: selectedDatabase.id,
          resourceName: selectedDatabase.name,
          message: "Downloaded wallet for",
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdbBusyAction(null)
    }
  }, [selectedDatabase, walletPassword])

  const handleConnect = useCallback(async () => {
    if (!selectedDatabase?.id) {
      setError("Please select a database first.")
      return
    }
    setError(null)
    setSqlResult(null)
    setAdbBusyAction("connect")
    try {
      const response = await ResourceServiceClient.connectAdb({
        autonomousDatabaseId: selectedDatabase.id,
        walletPath,
        walletPassword,
        username,
        password,
        serviceName,
      })
      setConnectionId(response.connectionId)
      setConnectionTarget({
        autonomousDatabaseId: response.autonomousDatabaseId,
        serviceName: response.serviceName,
        walletPath: response.walletPath,
      })
      setHighlightedDatabaseId(selectedDatabase.id)
      setRecentAction({
        resourceId: selectedDatabase.id,
        resourceName: selectedDatabase.name,
        message: "Connected to",
        timestamp: Date.now(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdbBusyAction(null)
    }
  }, [password, selectedDatabase, serviceName, username, walletPassword, walletPath])

  const disconnectConnection = useCallback(async (id: string) => {
    if (!id) return
    await ResourceServiceClient.disconnectAdb(id)
  }, [])

  const handleDisconnect = useCallback(async () => {
    if (!connectionId) return
    setError(null)
    setAdbBusyAction("disconnect")
    try {
      await disconnectConnection(connectionId)
      if (selectedDatabase) {
        setHighlightedDatabaseId(selectedDatabase.id)
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
      setAdbBusyAction(null)
    }
  }, [connectionId, disconnectConnection])

  const loadSavedProfile = useCallback(async (dbId: string) => {
    try {
      const saved = await ResourceServiceClient.loadAdbConnection(dbId) as LoadAdbConnectionResponse | Record<string, never>
      if (saved && "autonomousDatabaseId" in saved && saved.autonomousDatabaseId) {
        setWalletPath(saved.walletPath || "")
        setWalletPassword(saved.walletPassword || "")
        setUsername(saved.username || "")
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

  useEffect(() => {
    const previous = previousSelectedAdbIdRef.current
    if (!selectedAdbId) {
      previousSelectedAdbIdRef.current = selectedAdbId
      return
    }
    if (previous && previous !== selectedAdbId) {
      const activeConnectionId = connectionId
      setConnectionId("")
      setConnectionTarget(null)
      setSqlResult(null)
      setServiceNames([])
      setServiceName("")
      setWalletPath("")
      setWalletPassword("")
      setUsername("")
      setPassword("")
      setHasSavedProfile(false)
      setDiagnostics(null)
      if (activeConnectionId) {
        void disconnectConnection(activeConnectionId)
      }
      void loadSavedProfile(selectedAdbId)
    } else if (!previous) {
      void loadSavedProfile(selectedAdbId)
    }
    previousSelectedAdbIdRef.current = selectedAdbId
  }, [connectionId, disconnectConnection, loadSavedProfile, selectedAdbId])

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
    setAdbBusyAction("execute")
    try {
      const response = await ResourceServiceClient.executeAdbSql({
        connectionId,
        sql,
      })
      setSqlResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdbBusyAction(null)
    }
  }, [connectionId, sql])

  const handleSaveConnection = useCallback(async () => {
    if (!selectedDatabase?.id) return
    setError(null)
    setAdbBusyAction("save")
    try {
      await ResourceServiceClient.saveAdbConnection({
        autonomousDatabaseId: selectedDatabase.id,
        walletPath,
        walletPassword,
        username,
        password,
        serviceName,
      })
      setHasSavedProfile(true)
      if (selectedDatabase) {
        setHighlightedDatabaseId(selectedDatabase.id)
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
      setAdbBusyAction(null)
    }
  }, [password, selectedDatabase, serviceName, username, walletPassword, walletPath])

  const handleDeleteConnection = useCallback(async () => {
    if (!selectedDatabase?.id) return
    setError(null)
    setAdbBusyAction("delete")
    try {
      await ResourceServiceClient.deleteAdbConnection(selectedDatabase.id)
      setHasSavedProfile(false)
      setHighlightedDatabaseId(selectedDatabase.id)
      setRecentAction({
        resourceId: selectedDatabase.id,
        resourceName: selectedDatabase.name,
        message: "Deleted saved profile for",
        timestamp: Date.now(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdbBusyAction(null)
    }
  }, [selectedDatabase])

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

  const revealDatabase = useCallback((databaseId: string) => {
    setQuery("")
    setSelectedAdbId(databaseId)
    setActiveTab("overview")
    setShowDatabaseWorkspace(false)
    setHighlightedDatabaseId(databaseId)
  }, [])

  return (
    <FeaturePageLayout
      title="Autonomous Database"
      description="Browse Autonomous Databases, manage lifecycle actions, and run SQL from the same page."
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
          <CompartmentSelector featureKey="adb" multiple />
          {databases.length > 0 && (
            <FeatureSearchInput
              value={query}
              onChange={setQuery}
              placeholder="Filter autonomous databases..."
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
                <WorkbenchRevealButton onClick={() => revealDatabase(recentAction.resourceId)} title="Show this database in the list" label="Show Database" />
                <WorkbenchDismissButton onClick={() => setRecentAction(null)} title="Dismiss" />
              </>
            )}
          >
            <div className="min-w-0">
              {recentAction.message} <span className="text-[var(--vscode-foreground)]">{recentAction.resourceName}</span> {formatRecentActionAge(recentAction.timestamp)}
            </div>
          </InlineNotice>
        )}

        {loading && databases.length === 0 ? (
          <WorkbenchLoadingState
            label="Loading databases..."
            className="min-h-[140px] py-4"
          />
        ) : databases.length === 0 ? (
          <div className="flex flex-1">
            <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            {showDatabaseWorkspace && selectedDatabase ? (
              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-panel-border)] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDatabaseWorkspace(false)}
                      className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                      title="Back to Autonomous Databases"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">
                        Autonomous Database
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
                        { label: "DB", value: connectionTarget.autonomousDatabaseId },
                        { label: "Service", value: connectionTarget.serviceName },
                        { label: "Wallet", value: connectionTarget.walletPath, breakAll: true },
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
                          subtitle="Download wallets, keep a saved profile, and maintain the active database session."
                        >
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              type="password"
                              label="Wallet Password"
                              value={walletPassword}
                              onChange={e => setWalletPassword(e.target.value)}
                              placeholder="At least 8 chars"
                            />
                            <div className="flex items-end">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                className="w-full gap-1.5"
                                onClick={handleDownloadWallet}
                                disabled={adbBusyAction !== null || !selectedAdbId || walletPassword.trim().length < 8}
                              >
                                {adbBusyAction === "wallet" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                Download Wallet
                              </Button>
                            </div>
                          </div>

                          <Input
                            label="Wallet Path"
                            value={walletPath}
                            onChange={e => setWalletPath(e.target.value)}
                            placeholder="Wallet directory path"
                          />

                          <div className="grid gap-2 sm:grid-cols-3">
                            <Input
                              label="Username"
                              value={username}
                              onChange={e => setUsername(e.target.value)}
                              placeholder="ADMIN"
                            />
                            <Input
                              type="password"
                              label="Password"
                              value={password}
                              onChange={e => setPassword(e.target.value)}
                              placeholder="Database password"
                            />
                            <div className="flex flex-col gap-1.5">
                              <label className="text-xs font-medium text-description">Service Name</label>
                              <input
                                value={serviceName}
                                onChange={e => setServiceName(e.target.value)}
                                list="adb-service-names"
                                placeholder="e.g. dbname_high"
                                className="w-full rounded-md border border-input-border bg-input-background px-3 py-2 text-sm text-input-foreground outline-none focus:border-border placeholder:text-input-placeholder"
                              />
                              <datalist id="adb-service-names">
                                {serviceNames.map((name) => <option key={name} value={name} />)}
                              </datalist>
                            </div>
                          </div>

                          <WorkbenchToolbarGroup>
                            <Button
                              type="button"
                              size="sm"
                              className="gap-1.5"
                              onClick={handleConnect}
                              disabled={
                                adbBusyAction !== null ||
                                Boolean(connectionId) ||
                                !selectedAdbId ||
                                !walletPath.trim() ||
                                !walletPassword.trim() ||
                                !username.trim() ||
                                !password ||
                                !serviceName.trim()
                              }
                            >
                              {adbBusyAction === "connect" ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                              Connect
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="gap-1.5"
                              onClick={handleDisconnect}
                              disabled={adbBusyAction !== null || !connectionId}
                            >
                              {adbBusyAction === "disconnect" ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                              Disconnect
                            </Button>
                            <WorkbenchActionButton
                              type="button"
                              onClick={handleDiagnostics}
                              disabled={loadingDiagnostics}
                            >
                              {loadingDiagnostics ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                              Connection Diagnostic
                            </WorkbenchActionButton>
                            <WorkbenchToolbarSpacer>
                              <WorkbenchInlineActionCluster>
                                <WorkbenchActionButton
                                  type="button"
                                  onClick={handleSaveConnection}
                                  disabled={
                                    adbBusyAction !== null ||
                                    !selectedAdbId ||
                                    !walletPath.trim() ||
                                    !username.trim() ||
                                    !serviceName.trim()
                                  }
                                >
                                  {adbBusyAction === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                  {hasSavedProfile ? "Saved" : "Save"}
                                </WorkbenchActionButton>
                                {hasSavedProfile && (
                                  <WorkbenchDestructiveButton
                                    type="button"
                                    onClick={handleDeleteConnection}
                                    disabled={adbBusyAction !== null}
                                  >
                                    {adbBusyAction === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                    Delete
                                  </WorkbenchDestructiveButton>
                                )}
                              </WorkbenchInlineActionCluster>
                            </WorkbenchToolbarSpacer>
                          </WorkbenchToolbarGroup>
                        </WorkbenchSection>
                      </TabsContent>
                      <TabsContent value="query" className="flex-1 overflow-auto pt-1.5">
                        <WorkbenchSection
                          title="SQL Runner"
                          subtitle="Run statements against the current ADB session and inspect the returned rows."
                        >
                          <Textarea
                            label="SQL"
                            value={sql}
                            onChange={e => setSql(e.target.value)}
                            rows={5}
                            className="min-h-0 font-mono text-xs"
                            placeholder="SELECT * FROM your_table FETCH FIRST 20 ROWS ONLY"
                          />
                          <WorkbenchActionButton
                            type="button"
                            className="w-fit"
                            onClick={handleExecuteSql}
                            disabled={adbBusyAction !== null || !connectionId || !sql.trim()}
                          >
                            {adbBusyAction === "execute" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                            Execute SQL
                          </WorkbenchActionButton>

                          {sqlResult ? (
                            <WorkbenchQueryResult result={sqlResult} />
                          ) : (
                            <WorkbenchEmptyState
                              title="No query output yet"
                              description="Connect to the selected database and execute a statement to populate this area."
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
                      label="Database inventory"
                      count={filtered.length === databases.length
                        ? `${databases.length} autonomous database${databases.length !== 1 ? "s" : ""}`
                        : `${filtered.length} of ${databases.length} autonomous databases`}
                      description="Select an Autonomous Database to manage lifecycle, wallet download, and SQL execution."
                    />

                    {filtered.length === 0 ? (
                      <WorkbenchInventoryFilterEmpty message="No Autonomous Databases match your filter." />
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
                                {regionGroup.databases.map((db) => (
                                  <DatabaseCard
                                    key={`${db.id}-${db.region ?? "default"}`}
                                    database={db}
                                    selected={db.id === selectedAdbId}
                                    highlighted={highlightedDatabaseId === db.id}
                                    onRegisterRef={(node) => {
                                      if (node) {
                                        databaseItemRefs.current.set(db.id, node)
                                      } else {
                                        databaseItemRefs.current.delete(db.id)
                                      }
                                    }}
                                    actionState={actionState}
                                    onStart={handleStart}
                                    onStop={handleStop}
                                    onRequestGuardrail={setGuardrail}
                                    onSelect={(id) => {
                                      setSelectedAdbId(id)
                                      setShowDatabaseWorkspace(true)
                                    }}
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
  database,
  selected,
  highlighted,
  onRegisterRef,
  actionState,
  onStart,
  onStop,
  onRequestGuardrail,
  onSelect,
}: {
  database: AdbResource
  selected: boolean
  highlighted: boolean
  onRegisterRef: (node: HTMLDivElement | null) => void
  actionState: ActionState
  onStart: (id: string, region?: string) => void
  onStop: (id: string, region?: string) => void
  onRequestGuardrail: (value: WorkbenchGuardrailState) => void
  onSelect: (id: string) => void
}) {
  const isActing = actionState?.id === database.id
  const isAvailable = database.lifecycleState === "AVAILABLE"
  const isStopped = database.lifecycleState === "STOPPED"

  return (
    <WorkbenchActionInventoryCard
      cardRef={onRegisterRef}
      title={database.name}
      subtitle={database.id}
      selected={selected}
      highlighted={highlighted}
      onSelect={() => onSelect(database.id)}
      trailing={<LifecycleBadge state={database.lifecycleState} size="compact" />}
      actions={(
        <>
          <WorkbenchSelectButton selected={selected} onClick={() => onSelect(database.id)} />
          <WorkbenchGuardrailActionButton
            disabled={isActing || !isStopped}
            guardrail={createStartResourceGuardrail({
              resourceKind: "autonomous-database",
              details: buildWorkbenchResourceGuardrailDetails({
                resourceLabel: "Database",
                resourceName: database.name,
                region: database.region || "default",
              }),
              onConfirm: async () => {
                await onStart(database.id, database.region)
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
              resourceKind: "autonomous-database",
              details: buildWorkbenchResourceGuardrailDetails({
                resourceLabel: "Database",
                resourceName: database.name,
                region: database.region || "default",
              }),
              onConfirm: async () => {
                await onStop(database.id, database.region)
              },
            })}
            onRequestGuardrail={onRequestGuardrail}
            busy={isActing && actionState?.action === "stopping"}
            idleIcon={<StopCircle size={12} />}
            label="Stop"
          />
        </>
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
      title={hasSelectedCompartments ? "No Autonomous Databases Found" : "No Compartment Selected"}
      description={hasSelectedCompartments
        ? "No Autonomous Databases were found in the selected compartments."
        : "Please select one or more compartments."}
      icon={<Database size={24} className="opacity-70" />}
    />
  )
}

function groupAdbByCompartmentAndRegion(databases: AdbResource[]): { compartmentId: string; regions: { region: string; databases: AdbResource[] }[] }[] {
  const compartmentMap = new Map<string, Map<string, AdbResource[]>>()
  for (const db of databases) {
    const compartmentId = db.compartmentId || "unknown-compartment"
    const region = db.region || "default"
    if (!compartmentMap.has(compartmentId)) {
      compartmentMap.set(compartmentId, new Map<string, AdbResource[]>())
    }
    const regionMap = compartmentMap.get(compartmentId)!
    if (!regionMap.has(region)) {
      regionMap.set(region, [])
    }
    regionMap.get(region)!.push(db)
  }
  return [...compartmentMap.entries()].map(([compartmentId, regions]) => ({
    compartmentId,
    regions: [...regions.entries()].map(([region, groupedDatabases]) => ({ region, databases: groupedDatabases })),
  }))
}
