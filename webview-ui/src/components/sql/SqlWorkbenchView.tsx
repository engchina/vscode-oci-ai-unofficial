import {
  ChevronLeft,
  Database,
  Download,
  Loader2,
  Plug,
  Save,
  Search,
  SquareTerminal,
  Trash2,
  Unplug,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient, SqlWorkbenchServiceClient } from "../../services/grpc-client"
import type {
  AdbResource,
  ConnectAdbResponse,
  ConnectDbSystemResponse,
  DbSystemConnectionString,
  DbSystemResource,
  ExecuteAdbSqlResponse,
  ExplainSqlPlanResponse,
  LoadAdbConnectionResponse,
  LoadDbSystemConnectionResponse,
  SqlAssistantMode,
  SqlAssistantResponse,
  SqlFavoriteEntry,
  SqlHistoryEntry,
  SqlWorkbenchConnectionType,
  TestSqlConnectionResponse,
} from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import Card from "../ui/Card"
import Input from "../ui/Input"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
import {
  DatabaseContextStrip,
  DatabaseWorkbenchHero,
  SummaryMetaCard,
  WorkbenchEmptyState,
  WorkbenchSurface,
  WorkbenchSection,
} from "../workbench/DatabaseWorkbenchChrome"
import {
  WorkbenchActionButton,
  WorkbenchActionToggleButton,
  WorkbenchCompactActionCluster,
  WorkbenchDestructiveButton,
  WorkbenchInlineActionCluster,
} from "../workbench/WorkbenchActionButtons"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import WorkbenchInventoryCard from "../workbench/WorkbenchInventoryCard"
import {
  WorkbenchInventoryFilterEmpty,
  WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import { WorkbenchSegmentedControl } from "../workbench/WorkbenchCompactControls"
import WorkbenchQueryResult from "../workbench/WorkbenchQueryResult"
import { WorkbenchRefreshButton, WorkbenchToolbarGroup } from "../workbench/WorkbenchToolbar"
import {
  createClearResourceGuardrail,
  buildWorkbenchResourceGuardrailDetails,
  createDeleteResourceGuardrail,
  createOverwriteResourceGuardrail,
  createSaveResourceGuardrail,
  type WorkbenchGuardrailState,
} from "../workbench/guardrail"

type BusyAction =
  | "load"
  | "wallet"
  | "connect"
  | "disconnect"
  | "test"
  | "execute"
  | "plan"
  | "assistant"
  | "saveProfile"
  | "deleteProfile"
  | "saveFavorite"
  | "deleteFavorite"
  | "clearHistory"
  | null

type SqlTarget = AdbResource | DbSystemResource

type ConnectionSummary = {
  connectionType: SqlWorkbenchConnectionType
  targetId: string
  targetName: string
  serviceName: string
}

type WorkspacePanel = "results" | "library" | "assistant"

export default function SqlWorkbenchView() {
  const { sqlWorkbench, navigateToView } = useExtensionState()
  const { pendingSelection, setPendingSelection, setResource } = useWorkbenchInsight()
  const [targetType, setTargetType] = useState<SqlWorkbenchConnectionType>("adb")
  const [adbTargets, setAdbTargets] = useState<AdbResource[]>([])
  const [dbSystemTargets, setDbSystemTargets] = useState<DbSystemResource[]>([])
  const [targetFilter, setTargetFilter] = useState("")
  const [selectedTargetId, setSelectedTargetId] = useState("")
  const [requestedTargetSelection, setRequestedTargetSelection] = useState<{ targetId: string; targetType: SqlWorkbenchConnectionType } | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction>("load")
  const [error, setError] = useState<string | null>(null)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)

  const [walletPassword, setWalletPassword] = useState("")
  const [walletPath, setWalletPath] = useState("")
  const [serviceNames, setServiceNames] = useState<string[]>([])
  const [connectionStrings, setConnectionStrings] = useState<DbSystemConnectionString[]>([])
  const [serviceName, setServiceName] = useState("")
  const [username, setUsername] = useState("ADMIN")
  const [password, setPassword] = useState("")
  const [hasSavedProfile, setHasSavedProfile] = useState(false)

  const [connectionId, setConnectionId] = useState("")
  const [connectionSummary, setConnectionSummary] = useState<ConnectionSummary | null>(null)
  const [testResult, setTestResult] = useState<TestSqlConnectionResponse | null>(null)
  const [sql, setSql] = useState("SELECT SYSDATE AS CURRENT_TIME FROM DUAL")
  const [sqlResult, setSqlResult] = useState<ExecuteAdbSqlResponse | null>(null)
  const [planResult, setPlanResult] = useState<ExplainSqlPlanResponse | null>(null)
  const [favoriteLabel, setFavoriteLabel] = useState("")
  const [favoriteDescription, setFavoriteDescription] = useState("")
  const [assistantMode, setAssistantMode] = useState<SqlAssistantMode>("generate")
  const [assistantPrompt, setAssistantPrompt] = useState("")
  const [schemaContext, setSchemaContext] = useState("")
  const [assistantResult, setAssistantResult] = useState<SqlAssistantResponse | null>(null)
  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>("results")
  const [showSqlWorkspace, setShowSqlWorkspace] = useState(false)

  const previousTargetKeyRef = useRef("")
  const guardrailBusy = busyAction === "saveProfile"
    || busyAction === "deleteProfile"
    || busyAction === "deleteFavorite"
    || busyAction === "clearHistory"

  const targets = targetType === "adb" ? adbTargets : dbSystemTargets
  const filteredTargets = useMemo(() => {
    const query = targetFilter.trim().toLowerCase()
    if (!query) {
      return targets
    }
    return targets.filter((item) => {
      const name = item.name?.toLowerCase() ?? ""
      const id = item.id?.toLowerCase() ?? ""
      const region = item.region?.toLowerCase() ?? ""
      return name.includes(query) || id.includes(query) || region.includes(query)
    })
  }, [targetFilter, targets])
  const selectedTarget = useMemo(
    () => targets.find((item) => item.id === selectedTargetId) ?? null,
    [selectedTargetId, targets],
  )
  const targetTypeLabel = targetType === "adb" ? "Autonomous DB" : "DB System"
  const requiresWallet = targetType === "adb"
  const canManageConnection = Boolean(
    selectedTargetId
    && serviceName.trim()
    && username.trim()
    && password
    && (!requiresWallet || (walletPath.trim() && walletPassword.trim())),
  )
  const isConnectedToSelection = Boolean(
    connectionId
    && connectionSummary
    && selectedTarget
    && connectionSummary.targetId === selectedTarget.id,
  )

  useEffect(() => {
    if (!selectedTarget) {
      setResource(null)
      return
    }

    setResource({
      view: "sqlWorkbench",
      title: selectedTarget.name,
      eyebrow: targetType === "adb" ? "SQL Target • ADB" : "SQL Target • DB System",
      resourceId: selectedTarget.id,
      badge: isConnectedToSelection
        ? { label: "Connected", tone: "success" }
        : { label: selectedTarget.lifecycleState || "Idle", tone: toneFromLifecycleState(selectedTarget.lifecycleState) },
      metrics: [
        { label: "Region", value: selectedTarget.region || "default" },
        { label: "Service", value: serviceName || "Not set" },
        { label: "User", value: username || "Not set" },
        { label: "Panel", value: workspacePanel },
      ],
      notes: [
        `Favorites: ${sqlWorkbench.favorites.length} • History: ${sqlWorkbench.history.length}`,
        assistantResult?.suggestedSql ? "Assistant has a suggested SQL snippet ready to apply." : "Assistant output is idle.",
      ],
      actions: [
        ...(workspacePanel !== "results"
          ? [{
            label: "Show Results",
            run: () => setWorkspacePanel("results"),
            variant: "ghost" as const,
          }]
          : []),
        ...(workspacePanel !== "library"
          ? [{
            label: "Open Library",
            run: () => setWorkspacePanel("library"),
            variant: "ghost" as const,
          }]
          : []),
        ...(workspacePanel !== "assistant"
          ? [{
            label: "Ask Assistant",
            run: () => setWorkspacePanel("assistant"),
            variant: "secondary" as const,
          }]
          : []),
        {
          label: targetType === "adb" ? "Open ADB" : "Open DB Systems",
          run: () => {
            if (!selectedTarget) {
              return
            }
            if (targetType === "adb") {
              setPendingSelection({
                view: "adb",
                targetId: selectedTarget.id,
              })
              navigateToView("adb")
              return
            }
            setPendingSelection({
              view: "dbSystems",
              targetId: selectedTarget.id,
            })
            navigateToView("dbSystems")
          },
          variant: "secondary",
        },
      ],
    })

    return () => setResource(null)
  }, [
    assistantResult?.suggestedSql,
    isConnectedToSelection,
    navigateToView,
    selectedTarget,
    serviceName,
    setPendingSelection,
    setResource,
    sqlWorkbench.favorites.length,
    sqlWorkbench.history.length,
    targetType,
    username,
    workspacePanel,
  ])

  useEffect(() => {
    if (pendingSelection?.view !== "sqlWorkbench") {
      return
    }

    setTargetType(pendingSelection.targetType)
    setRequestedTargetSelection({
      targetId: pendingSelection.targetId,
      targetType: pendingSelection.targetType,
    })
    setShowSqlWorkspace(true)
    setPendingSelection(null)
  }, [pendingSelection, setPendingSelection])

  useEffect(() => {
    if (!selectedTarget) {
      setShowSqlWorkspace(false)
    }
  }, [selectedTarget])

  useEffect(() => {
    void loadTargets()
  }, [])

  useEffect(() => {
    if (requestedTargetSelection && requestedTargetSelection.targetType === targetType) {
      if (targets.some((item) => item.id === requestedTargetSelection.targetId)) {
        setSelectedTargetId(requestedTargetSelection.targetId)
        setRequestedTargetSelection(null)
      }
      return
    }
    if (!targets.some((item) => item.id === selectedTargetId)) {
      setSelectedTargetId(targets[0]?.id ?? "")
    }
  }, [requestedTargetSelection, selectedTargetId, targetType, targets])

  useEffect(() => {
    const targetKey = `${targetType}:${selectedTargetId}`
    const previousTargetKey = previousTargetKeyRef.current
    if (!selectedTargetId) {
      previousTargetKeyRef.current = targetKey
      return
    }

    if (previousTargetKey === targetKey) {
      return
    }

    if (previousTargetKey) {
      if (connectionId && connectionSummary) {
        void disconnectSession(connectionId, connectionSummary.connectionType)
      }
      setConnectionId("")
      setConnectionSummary(null)
      setSqlResult(null)
      setPlanResult(null)
      setTestResult(null)
      setAssistantResult(null)
    }

    setHasSavedProfile(false)
    setServiceNames([])
    setConnectionStrings([])
    setWalletPath("")
    setWalletPassword("")
    setServiceName("")
    setPassword("")
    setUsername(targetType === "adb" ? "ADMIN" : "SYSTEM")

    if (targetType === "adb") {
      void loadSavedAdbProfile(selectedTargetId)
    } else {
      void loadSavedDbSystemProfile(selectedTargetId)
      if (selectedTarget && "compartmentId" in selectedTarget && selectedTarget.compartmentId) {
        void fetchDbSystemConnectionStrings(selectedTarget)
      }
    }

    previousTargetKeyRef.current = targetKey
  }, [connectionId, connectionSummary, selectedTarget, selectedTargetId, targetType])

  useEffect(() => {
    return () => {
      if (connectionId && connectionSummary) {
        void disconnectSession(connectionId, connectionSummary.connectionType)
      }
    }
  }, [connectionId, connectionSummary])

  async function loadTargets(): Promise<void> {
    setBusyAction("load")
    setError(null)
    try {
      const [adbResponse, dbSystemsResponse] = await Promise.all([
        ResourceServiceClient.listAdb(),
        ResourceServiceClient.listDbSystems(),
      ])
      setAdbTargets(adbResponse.databases ?? [])
      setDbSystemTargets(dbSystemsResponse.dbSystems ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function loadSavedAdbProfile(adbId: string): Promise<void> {
    try {
      const saved = await ResourceServiceClient.loadAdbConnection(adbId) as LoadAdbConnectionResponse | Record<string, never>
      if (saved && "autonomousDatabaseId" in saved && saved.autonomousDatabaseId) {
        setWalletPath(saved.walletPath || "")
        setWalletPassword(saved.walletPassword || "")
        setUsername(saved.username || "ADMIN")
        setPassword(saved.password || "")
        setServiceName(saved.serviceName || "")
        setHasSavedProfile(true)
      }
    } catch {
      // Best effort only.
    }
  }

  async function loadSavedDbSystemProfile(dbSystemId: string): Promise<void> {
    try {
      const saved = await ResourceServiceClient.loadDbSystemConnection(dbSystemId) as LoadDbSystemConnectionResponse | Record<string, never>
      if (saved && "dbSystemId" in saved && saved.dbSystemId) {
        setUsername(saved.username || "SYSTEM")
        setPassword(saved.password || "")
        setServiceName(saved.serviceName || "")
        setHasSavedProfile(true)
      }
    } catch {
      // Best effort only.
    }
  }

  async function fetchDbSystemConnectionStrings(target: DbSystemResource): Promise<void> {
    try {
      const response = await ResourceServiceClient.getDbSystemConnectionStrings({
        dbSystemId: target.id,
        compartmentId: target.compartmentId ?? "",
        region: target.region,
        publicIp: target.publicIp,
      })
      setConnectionStrings(response.connectionStrings ?? [])
    } catch {
      setConnectionStrings([])
    }
  }

  async function disconnectSession(id: string, connectionType: SqlWorkbenchConnectionType): Promise<void> {
    if (!id) {
      return
    }
    if (connectionType === "adb") {
      await ResourceServiceClient.disconnectAdb(id)
      return
    }
    await ResourceServiceClient.disconnectDbSystem(id)
  }

  async function handleDownloadWallet(): Promise<void> {
    if (!selectedTarget || targetType !== "adb") {
      setError("Select an Autonomous Database first.")
      return
    }
    setBusyAction("wallet")
    setError(null)
    try {
      const response = await ResourceServiceClient.downloadAdbWallet({
        autonomousDatabaseId: selectedTarget.id,
        walletPassword,
        region: selectedTarget.region,
      })
      setWalletPath(response.walletPath)
      setServiceNames(response.serviceNames ?? [])
      setServiceName((response.serviceNames ?? [])[0] ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleTestConnection(): Promise<void> {
    if (!selectedTarget) {
      setError("Select a database target first.")
      return
    }
    setBusyAction("test")
    setError(null)
    setTestResult(null)
    try {
      const response = targetType === "adb"
        ? await SqlWorkbenchServiceClient.testAdbConnection({
          autonomousDatabaseId: selectedTarget.id,
          walletPath,
          walletPassword,
          username,
          password,
          serviceName,
        })
        : await SqlWorkbenchServiceClient.testDbSystemConnection({
          dbSystemId: selectedTarget.id,
          username,
          password,
          serviceName,
        })
      setTestResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleConnect(): Promise<void> {
    if (!selectedTarget) {
      setError("Select a database target first.")
      return
    }
    setBusyAction("connect")
    setError(null)
    setSqlResult(null)
    setPlanResult(null)
    try {
      if (targetType === "adb") {
        const response = await ResourceServiceClient.connectAdb({
          autonomousDatabaseId: selectedTarget.id,
          walletPath,
          walletPassword,
          username,
          password,
          serviceName,
        })
        setConnectionFromAdbResponse(response, selectedTarget.name)
      } else {
        const response = await ResourceServiceClient.connectDbSystem({
          dbSystemId: selectedTarget.id,
          username,
          password,
          serviceName,
        })
        setConnectionFromDbSystemResponse(response, selectedTarget.name)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function setConnectionFromAdbResponse(response: ConnectAdbResponse, targetName: string): void {
    setConnectionId(response.connectionId)
    setConnectionSummary({
      connectionType: "adb",
      targetId: response.autonomousDatabaseId,
      targetName,
      serviceName: response.serviceName,
    })
  }

  function setConnectionFromDbSystemResponse(response: ConnectDbSystemResponse, targetName: string): void {
    setConnectionId(response.connectionId)
    setConnectionSummary({
      connectionType: "dbSystem",
      targetId: response.dbSystemId,
      targetName,
      serviceName: response.serviceName,
    })
  }

  async function handleDisconnect(): Promise<void> {
    if (!connectionId || !connectionSummary) {
      return
    }
    setBusyAction("disconnect")
    setError(null)
    try {
      await disconnectSession(connectionId, connectionSummary.connectionType)
      setConnectionId("")
      setConnectionSummary(null)
      setSqlResult(null)
      setPlanResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRunSql(): Promise<void> {
    if (!connectionId || !selectedTarget) {
      setError("Connect before running SQL.")
      return
    }
    setWorkspacePanel("results")
    setBusyAction("execute")
    setError(null)
    setPlanResult(null)
    try {
      const request = {
        connectionId,
        sql,
        connectionType: targetType,
        targetId: selectedTarget.id,
        targetName: selectedTarget.name,
        serviceName,
        username,
      }
      const response = targetType === "adb"
        ? await ResourceServiceClient.executeAdbSql(request)
        : await ResourceServiceClient.executeDbSystemSql(request)
      setSqlResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleExplainPlan(): Promise<void> {
    if (!connectionId || !selectedTarget) {
      setError("Connect before generating an explain plan.")
      return
    }
    setWorkspacePanel("results")
    setBusyAction("plan")
    setError(null)
    try {
      const request = {
        connectionId,
        sql,
        connectionType: targetType,
        targetId: selectedTarget.id,
        targetName: selectedTarget.name,
        serviceName,
        username,
      }
      const response = targetType === "adb"
        ? await SqlWorkbenchServiceClient.explainAdbSqlPlan(request)
        : await SqlWorkbenchServiceClient.explainDbSystemSqlPlan(request)
      setPlanResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  async function persistConnectionProfile(): Promise<void> {
    if (!selectedTarget) {
      return
    }
    setBusyAction("saveProfile")
    setError(null)
    try {
      if (targetType === "adb") {
        await ResourceServiceClient.saveAdbConnection({
          autonomousDatabaseId: selectedTarget.id,
          walletPath,
          walletPassword,
          username,
          password,
          serviceName,
        })
      } else {
        await ResourceServiceClient.saveDbSystemConnection({
          dbSystemId: selectedTarget.id,
          username,
          password,
          serviceName,
        })
      }
      setHasSavedProfile(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function requestSaveProfile(): void {
    if (!selectedTarget) {
      return
    }
    if (!hasSavedProfile) {
      void persistConnectionProfile()
      return
    }
    setGuardrail(createOverwriteResourceGuardrail({
      resourceKind: "sql-connection-profile",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Target",
        resourceName: selectedTarget.name,
        region: selectedTarget.region || "default",
        extras: [
          { label: "Connection Mode", value: targetTypeLabel },
          { label: "Service", value: serviceName || "Not set" },
          { label: "User", value: username || "Not set" },
        ],
      }),
      onConfirm: persistConnectionProfile,
    }))
  }

  async function deleteConnectionProfile(): Promise<void> {
    if (!selectedTarget) {
      return
    }
    setBusyAction("deleteProfile")
    setError(null)
    try {
      if (targetType === "adb") {
        await ResourceServiceClient.deleteAdbConnection(selectedTarget.id)
      } else {
        await ResourceServiceClient.deleteDbSystemConnection(selectedTarget.id)
      }
      setHasSavedProfile(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function requestDeleteProfile(): void {
    if (!selectedTarget) {
      return
    }
    setGuardrail(createDeleteResourceGuardrail({
      resourceKind: "sql-connection-profile",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Target",
        resourceName: selectedTarget.name,
        region: selectedTarget.region || "default",
        extras: [
          { label: "Connection Mode", value: targetTypeLabel },
          { label: "Service", value: serviceName || "Not set" },
          { label: "User", value: username || "Not set" },
        ],
      }),
      onConfirm: deleteConnectionProfile,
    }))
  }

  function buildFavoriteTargetLabel(entry?: Pick<SqlFavoriteEntry, "connectionType" | "targetId" | "targetName">): string {
    return entry?.targetName || entry?.targetId || entry?.connectionType || "Workspace"
  }

  function resolveFavoriteConflict(label: string): SqlFavoriteEntry | null {
    const normalizedLabel = label.trim().toLowerCase()
    const activeTargetId = selectedTarget?.id || ""
    const activeTargetType = selectedTarget ? targetType : ""

    return sqlWorkbench.favorites.find((entry) => (
      entry.label.trim().toLowerCase() === normalizedLabel
      && (entry.targetId || "") === activeTargetId
      && (entry.connectionType || "") === activeTargetType
    )) ?? null
  }

  async function persistFavorite(id?: string): Promise<void> {
    const normalizedSql = sql.trim()
    if (!normalizedSql) {
      setError("Enter SQL before saving a favorite.")
      return
    }
    const normalizedLabel = favoriteLabel.trim() || buildDefaultFavoriteLabel(normalizedSql)
    setBusyAction("saveFavorite")
    setError(null)
    try {
      await SqlWorkbenchServiceClient.saveSqlFavorite({
        id,
        label: normalizedLabel,
        description: favoriteDescription.trim(),
        sql: normalizedSql,
        connectionType: targetType,
        targetId: selectedTarget?.id,
        targetName: selectedTarget?.name,
      })
      setFavoriteLabel("")
      setFavoriteDescription("")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function handleSaveFavorite(): void {
    const normalizedSql = sql.trim()
    if (!normalizedSql) {
      setError("Enter SQL before saving a favorite.")
      return
    }

    const normalizedLabel = favoriteLabel.trim() || buildDefaultFavoriteLabel(normalizedSql)
    const existingFavorite = resolveFavoriteConflict(normalizedLabel)
    if (!existingFavorite) {
      void persistFavorite()
      return
    }

    setGuardrail(createOverwriteResourceGuardrail({
      resourceKind: "sql-favorite",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Favorite",
        resourceName: normalizedLabel,
        extras: [
          { label: "Target", value: buildFavoriteTargetLabel(existingFavorite) },
          { label: "Saved SQL", value: summarizeSql(existingFavorite.sql) },
        ],
      }),
      onConfirm: () => persistFavorite(existingFavorite.id),
    }))
  }

  async function deleteFavorite(id: string): Promise<void> {
    setBusyAction("deleteFavorite")
    setError(null)
    try {
      await SqlWorkbenchServiceClient.deleteSqlFavorite({ id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function requestDeleteFavorite(entry: SqlFavoriteEntry): void {
    setGuardrail(createDeleteResourceGuardrail({
      resourceKind: "sql-favorite",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Favorite",
        resourceName: entry.label || buildDefaultFavoriteLabel(entry.sql),
        extras: [
          { label: "Target", value: buildFavoriteTargetLabel(entry) },
        ],
      }),
      onConfirm: () => deleteFavorite(entry.id),
    }))
  }

  async function clearHistory(): Promise<void> {
    setBusyAction("clearHistory")
    setError(null)
    try {
      await SqlWorkbenchServiceClient.clearSqlHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function requestClearHistory(): void {
    setGuardrail(createClearResourceGuardrail({
      resourceKind: "sql-history",
      resourceTitle: "SQL History",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Workspace",
        resourceName: selectedTarget?.name || "Current workspace",
        extras: [
          { label: "Entries", value: String(sqlWorkbench.history.length) },
        ],
      }),
      onConfirm: clearHistory,
    }))
  }

  async function handleGuardedAction(): Promise<void> {
    if (!guardrail) {
      return
    }
    try {
      await guardrail.onConfirm()
      setGuardrail(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardrail(null)
    }
  }

  async function handleAskAssistant(): Promise<void> {
    setWorkspacePanel("assistant")
    setBusyAction("assistant")
    setError(null)
    setAssistantResult(null)
    try {
      const response = await SqlWorkbenchServiceClient.requestSqlAssistant({
        mode: assistantMode,
        prompt: assistantPrompt,
        sql,
        schemaContext,
        connectionType: targetType,
        targetName: selectedTarget?.name,
      })
      setAssistantResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyAction(null)
    }
  }

  function applySqlSnippet(entry: SqlFavoriteEntry | SqlHistoryEntry): void {
    setSql(entry.sql)
    if (entry.connectionType && entry.connectionType !== targetType) {
      setTargetType(entry.connectionType)
    }
    if (entry.targetId) {
      setSelectedTargetId(entry.targetId)
    }
  }

  return (
    <>
      <FeaturePageLayout
        title="SQL Workbench"
        description="Connect, execute SQL, explain plans, and reuse history and favorites with target selection, saved connections, and AI assistance."
        icon={<Database size={16} />}
        actions={(
          <WorkbenchRefreshButton
            onClick={() => void loadTargets()}
            disabled={busyAction === "load"}
            spinning={busyAction === "load"}
            title="Refresh targets"
          />
        )}
      >
        <div className="flex h-full min-h-0 flex-col px-2 py-2">
          {error && (
            <InlineNotice tone="danger" size="md" className="mb-2">
              {error}
            </InlineNotice>
          )}

          <div className="min-h-0 flex-1">
            {showSqlWorkspace && selectedTarget ? (
              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                <div className="flex items-center gap-2 border-b border-[var(--vscode-panel-border)] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setShowSqlWorkspace(false)}
                    className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title="Back to target inventory"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">
                      SQL Workspace
                    </div>
                    <div className="truncate text-[10px] text-description">{selectedTarget.name}</div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <div className="flex h-full min-h-0 flex-col gap-2">
                    <DatabaseWorkbenchHero
                      eyebrow={targetTypeLabel}
                      title={selectedTarget.name}
                      resourceId={selectedTarget.id}
                      connected={isConnectedToSelection}
                      metaItems={[
                        { label: "Target", value: selectedTarget.name },
                        { label: "Region", value: selectedTarget.region || "default" },
                        { label: "Lifecycle", value: selectedTarget.lifecycleState || "Unknown" },
                        { label: "Service", value: serviceName || "Not set" },
                        { label: "User", value: username || "Not set" },
                      ]}
                    />

                    <div className="flex min-h-0 flex-1 flex-col gap-2">
                      <WorkbenchSection
                        className="shrink-0"
                        title="SQL Editor"
                        subtitle="Write SQL once, then execute, inspect plans, or save the current statement."
                        actions={(
                          <WorkbenchInlineActionCluster className="w-full sm:w-auto sm:justify-end">
                            <WorkbenchActionButton type="button" onClick={() => void handleRunSql()} disabled={!connectionId || !sql.trim() || busyAction !== null}>
                              {busyAction === "execute" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                              Run SQL
                            </WorkbenchActionButton>
                            <WorkbenchActionButton type="button" variant="secondary" onClick={() => void handleExplainPlan()} disabled={!connectionId || !sql.trim() || busyAction !== null}>
                              {busyAction === "plan" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                              Explain Plan
                            </WorkbenchActionButton>
                          </WorkbenchInlineActionCluster>
                        )}
                      >
                        <DatabaseContextStrip
                          items={connectionId
                            ? [
                              { label: "Session", value: connectionId.slice(0, 12) },
                              { label: "Service", value: connectionSummary?.serviceName ?? serviceName },
                              { label: "Mode", value: targetTypeLabel },
                            ]
                            : [
                              { label: "Status", value: "Connect to the selected target before running SQL or generating a plan." },
                            ]}
                        />
                        <Textarea
                          label="SQL"
                          value={sql}
                          onChange={(event) => setSql(event.target.value)}
                          className="min-h-[240px] flex-1 font-mono text-[12px]"
                          placeholder="SELECT * FROM your_table FETCH FIRST 20 ROWS ONLY"
                        />
                      </WorkbenchSection>

                      <WorkbenchSection
                        className="min-h-[320px] flex-1"
                        title="Workspace Panels"
                        subtitle="Switch between execution output, snippet library, and AI assistance without leaving the editor."
                        bodyClassName="min-h-0 gap-2"
                      >
                        <div className="flex flex-col gap-2 rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] p-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--vscode-descriptionForeground)]">Panel Selector</div>
                            <div className="mt-1 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">
                              Keep execution results, saved snippets, and AI guidance in one place.
                            </div>
                          </div>
                          <WorkbenchCompactActionCluster className="w-full flex-wrap gap-2 md:w-auto md:justify-end">
                            <WorkbenchActionToggleButton active={workspacePanel === "results"} onClick={() => setWorkspacePanel("results")}>
                              Results
                            </WorkbenchActionToggleButton>
                            <WorkbenchActionToggleButton active={workspacePanel === "library"} onClick={() => setWorkspacePanel("library")}>
                              Library
                            </WorkbenchActionToggleButton>
                            <WorkbenchActionToggleButton active={workspacePanel === "assistant"} onClick={() => setWorkspacePanel("assistant")}>
                              AI Assistant
                            </WorkbenchActionToggleButton>
                          </WorkbenchCompactActionCluster>
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto">
                          {workspacePanel === "results" && (
                            <div className="grid gap-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                              <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2">
                                <div className="mb-2 text-[12px] font-semibold text-[var(--vscode-foreground)]">Result Grid</div>
                                {sqlResult ? (
                                  <WorkbenchQueryResult result={sqlResult} />
                                ) : (
                                  <WorkbenchEmptyState
                                    title="No result set yet"
                                    description="Run the current statement to populate rows or affected row counts here."
                                  />
                                )}
                              </section>
                              <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2">
                                <div className="mb-2 text-[12px] font-semibold text-[var(--vscode-foreground)]">Explain Plan</div>
                                {planResult ? (
                                  <WorkbenchSurface>
                                    <div className="mb-2 text-[12px] text-description">{planResult.message}</div>
                                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--vscode-editor-foreground)]">
                                      {planResult.planLines.join("\n")}
                                    </pre>
                                  </WorkbenchSurface>
                                ) : (
                                  <WorkbenchEmptyState
                                    title="No plan captured"
                                    description="Generate an explain plan to inspect scan choices, cardinality, and join order."
                                  />
                                )}
                              </section>
                            </div>
                          )}

                          {workspacePanel === "library" && (
                            <div className="grid gap-2 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                              <div className="flex flex-col gap-2">
                                <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2">
                                  <div className="mb-2 text-[12px] font-semibold text-[var(--vscode-foreground)]">Save Current SQL</div>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <Input
                                      label="Favorite Name"
                                      value={favoriteLabel}
                                      onChange={(event) => setFavoriteLabel(event.target.value)}
                                      placeholder="Top slow sessions"
                                    />
                                    <Input
                                      label="Description"
                                      value={favoriteDescription}
                                      onChange={(event) => setFavoriteDescription(event.target.value)}
                                      placeholder="Optional note"
                                    />
                                  </div>
                                  <WorkbenchCompactActionCluster className="mt-2">
                                    <WorkbenchActionButton type="button" variant="secondary" onClick={() => void handleSaveFavorite()} disabled={!sql.trim() || busyAction !== null}>
                                      {busyAction === "saveFavorite" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                      Save Current SQL
                                    </WorkbenchActionButton>
                                  </WorkbenchCompactActionCluster>
                                </section>

                                <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2">
                                  <div className="mb-2 text-[12px] font-semibold text-[var(--vscode-foreground)]">Favorites</div>
                                  <SqlSnippetList
                                    emptyLabel="No favorites yet."
                                    items={sqlWorkbench.favorites}
                                    onApply={applySqlSnippet}
                                    onDelete={requestDeleteFavorite}
                                    deleteBusy={busyAction === "deleteFavorite"}
                                  />
                                </section>
                              </div>

                              <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">History</div>
                                  <WorkbenchCompactActionCluster>
                                    <WorkbenchActionButton type="button" variant="ghost" onClick={requestClearHistory} disabled={sqlWorkbench.history.length === 0 || busyAction !== null}>
                                      {busyAction === "clearHistory" ? "Clearing..." : "Clear History"}
                                    </WorkbenchActionButton>
                                  </WorkbenchCompactActionCluster>
                                </div>
                                <SqlSnippetList
                                  emptyLabel="No SQL history yet."
                                  items={sqlWorkbench.history}
                                  onApply={applySqlSnippet}
                                  deleteBusy={false}
                                />
                              </section>
                            </div>
                          )}

                          {workspacePanel === "assistant" && (
                            <div className="grid gap-2 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                              <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2.5">
                                <WorkbenchSegmentedControl
                                  className="mb-3"
                                  value={assistantMode}
                                  onChange={setAssistantMode}
                                  items={[
                                    { value: "generate", label: "NL to SQL" },
                                    { value: "optimize", label: "Optimize SQL" },
                                  ]}
                                />
                                <Textarea
                                  label="Prompt"
                                  value={assistantPrompt}
                                  onChange={(event) => setAssistantPrompt(event.target.value)}
                                  className="min-h-[100px]"
                                  placeholder={assistantMode === "generate" ? "List top 10 tables by segment size." : "Optimize the query for high-cardinality join predicates."}
                                />
                                <Textarea
                                  label="Schema Context"
                                  value={schemaContext}
                                  onChange={(event) => setSchemaContext(event.target.value)}
                                  className="min-h-[120px] font-mono text-[12px]"
                                  placeholder="tables: orders(order_id, customer_id, status, created_at)..."
                                />
                                <WorkbenchInlineActionCluster>
                                  <WorkbenchActionButton type="button" onClick={() => void handleAskAssistant()} disabled={busyAction !== null || (!assistantPrompt.trim() && !sql.trim())}>
                                    {busyAction === "assistant" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                                    Ask Assistant
                                  </WorkbenchActionButton>
                                  {assistantResult?.suggestedSql && (
                                    <WorkbenchActionButton type="button" variant="secondary" onClick={() => setSql(assistantResult.suggestedSql ?? "")}>
                                      Use Suggested SQL
                                    </WorkbenchActionButton>
                                  )}
                                </WorkbenchInlineActionCluster>
                              </section>

                              <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-2.5">
                                <div className="mb-2 text-[12px] font-semibold text-[var(--vscode-foreground)]">Assistant Output</div>
                                {assistantResult ? (
                                  <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,black_4%)] px-2 py-1.5">
                                    <pre className="whitespace-pre-wrap text-[11px] leading-5 text-[var(--vscode-editor-foreground)]">{assistantResult.content}</pre>
                                  </div>
                                ) : (
                                  <WorkbenchEmptyState
                                    title="No assistant output yet"
                                    description="Ask for SQL generation or optimization advice to get an explanation and suggested statement."
                                  />
                                )}
                              </section>
                            </div>
                          )}
                        </div>
                      </WorkbenchSection>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                <div className="h-full overflow-y-auto p-2">
                  <div className="flex flex-col gap-2">
                    <WorkbenchInventorySummary
                      label="Target inventory"
                      count={filteredTargets.length === targets.length
                        ? `${targets.length} ${targetType === "adb" ? "databases" : "systems"}`
                        : `${filteredTargets.length} of ${targets.length} visible`}
                      description="Choose a target, configure the connection profile, then open the SQL workspace."
                    />

                    <div className="grid gap-2 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
                      <Card title="Target Inventory">
                        <WorkbenchSegmentedControl
                          value={targetType}
                          onChange={setTargetType}
                          items={[
                            { value: "adb", label: "Autonomous DB" },
                            { value: "dbSystem", label: "DB System" },
                          ]}
                        />

                        <FeatureSearchInput
                          value={targetFilter}
                          onChange={setTargetFilter}
                          placeholder={`Filter ${targetType === "adb" ? "databases" : "systems"}...`}
                        />

                        {filteredTargets.length === 0 ? (
                          <WorkbenchInventoryFilterEmpty message="No targets match the current filter." />
                        ) : (
                          <div className="max-h-[520px] overflow-y-auto pr-1">
                            <div className="flex flex-col gap-2">
                              {filteredTargets.map((target) => (
                                <SqlTargetListItem
                                  key={target.id}
                                  target={target}
                                  selected={target.id === selectedTargetId}
                                  connected={Boolean(connectionSummary && connectionSummary.targetId === target.id)}
                                  onSelect={() => setSelectedTargetId(target.id)}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>

                      <div className="flex flex-col gap-2">
                        {selectedTarget ? (
                          <Card title="Selected Target">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <SummaryMetaCard label="Name" value={selectedTarget.name} />
                              <SummaryMetaCard label="Type" value={targetTypeLabel} />
                              <SummaryMetaCard label="Region" value={selectedTarget.region || "default"} />
                              <SummaryMetaCard label="Lifecycle" value={selectedTarget.lifecycleState || "Unknown"} />
                            </div>
                            {connectionSummary && connectionSummary.targetId === selectedTarget.id && (
                              <InlineNotice tone="success">
                                Connected via {connectionSummary.serviceName}
                              </InlineNotice>
                            )}
                            <WorkbenchCompactActionCluster>
                              <WorkbenchActionButton type="button" onClick={() => setShowSqlWorkspace(true)}>
                                Open SQL Workspace
                              </WorkbenchActionButton>
                            </WorkbenchCompactActionCluster>
                          </Card>
                        ) : (
                          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] px-6 py-10 text-center">
                            <div className="max-w-sm">
                              <div className="text-[13px] font-semibold text-[var(--vscode-foreground)]">Select a target to open the SQL workbench</div>
                              <div className="mt-2 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">
                                Choose an Autonomous Database or DB System from the inventory to configure a connection and start editing SQL.
                              </div>
                            </div>
                          </div>
                        )}

                        <Card title="Connection Profile">
                          {targetType === "adb" && (
                            <>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Input
                                  type="password"
                                  label="Wallet Password"
                                  value={walletPassword}
                                  onChange={(event) => setWalletPassword(event.target.value)}
                                  placeholder="At least 8 chars"
                                />
                                <div className="flex items-end">
                                  <WorkbenchActionButton
                                    type="button"
                                    variant="secondary"
                                    className="w-full"
                                    onClick={() => void handleDownloadWallet()}
                                    disabled={!selectedTargetId || walletPassword.trim().length < 8 || busyAction !== null}
                                  >
                                    {busyAction === "wallet" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                    Download Wallet
                                  </WorkbenchActionButton>
                                </div>
                              </div>
                              <Input
                                label="Wallet Path"
                                value={walletPath}
                                onChange={(event) => setWalletPath(event.target.value)}
                                placeholder="Wallet directory path"
                              />
                            </>
                          )}

                          <div className="grid gap-2 sm:grid-cols-3">
                            <Input
                              label="Username"
                              value={username}
                              onChange={(event) => setUsername(event.target.value)}
                              placeholder={targetType === "adb" ? "ADMIN" : "SYSTEM"}
                            />
                            <Input
                              type="password"
                              label="Password"
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              placeholder="Database password"
                            />
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[13px] leading-none text-foreground">Service Name</label>
                              <input
                                value={serviceName}
                                onChange={(event) => setServiceName(event.target.value)}
                                list={targetType === "adb" ? "sql-workbench-adb-services" : "sql-workbench-db-services"}
                                placeholder={targetType === "adb" ? "dbname_high" : "host:1521/service"}
                                className="h-[26px] rounded-[2px] border border-input-border bg-input-background px-2 text-[13px] text-input-foreground outline-none focus:border-border focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)] focus:-outline-offset-1"
                              />
                              <datalist id="sql-workbench-adb-services">
                                {serviceNames.map((item) => <option key={item} value={item} />)}
                              </datalist>
                              <datalist id="sql-workbench-db-services">
                                {connectionStrings.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}
                              </datalist>
                            </div>
                          </div>

                          {targetType === "dbSystem" && connectionStrings.length > 0 && (
                            <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,black_4%)] px-2.5 py-2 text-[11px] text-description">
                              {connectionStrings.slice(0, 4).map((item) => (
                                <div key={item.value}>
                                  <span className="text-foreground">{item.name}:</span> {item.value}
                                </div>
                              ))}
                            </div>
                          )}

                          <WorkbenchToolbarGroup>
                            <WorkbenchCompactActionCluster>
                              <WorkbenchActionButton
                                type="button"
                                variant="secondary"
                                onClick={() => void handleTestConnection()}
                                disabled={!canManageConnection || busyAction !== null}
                              >
                                {busyAction === "test" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                                Test Connection
                              </WorkbenchActionButton>
                              <WorkbenchActionButton
                                type="button"
                                onClick={() => void handleConnect()}
                                disabled={!canManageConnection || Boolean(connectionId) || busyAction !== null}
                              >
                                {busyAction === "connect" ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                                Connect
                              </WorkbenchActionButton>
                              <WorkbenchActionButton
                                type="button"
                                variant="secondary"
                                onClick={() => void handleDisconnect()}
                                disabled={!connectionId || busyAction !== null}
                              >
                                {busyAction === "disconnect" ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                                Disconnect
                              </WorkbenchActionButton>
                              <WorkbenchActionButton
                                type="button"
                                variant="secondary"
                                onClick={requestSaveProfile}
                                disabled={!selectedTargetId || !serviceName.trim() || !username.trim() || busyAction !== null}
                              >
                                {busyAction === "saveProfile" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                {hasSavedProfile ? "Saved" : "Save Profile"}
                              </WorkbenchActionButton>
                              {hasSavedProfile && (
                                <WorkbenchDestructiveButton
                                  type="button"
                                  onClick={requestDeleteProfile}
                                  disabled={busyAction !== null}
                                >
                                  {busyAction === "deleteProfile" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                  Delete Profile
                                </WorkbenchDestructiveButton>
                              )}
                            </WorkbenchCompactActionCluster>
                          </WorkbenchToolbarGroup>

                          {testResult && (
                            <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,green_4%)] px-2.5 py-2 text-[11px] text-description">
                              {testResult.message} {testResult.latencyMs > 0 ? `(${testResult.latencyMs} ms)` : ""}
                            </div>
                          )}
                        </Card>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </FeaturePageLayout>
      <GuardrailDialog
        open={guardrail !== null}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details ?? []}
        tone={guardrail?.tone}
        busy={guardrailBusy}
        onCancel={() => setGuardrail(null)}
        onConfirm={() => void handleGuardedAction()}
      />
    </>
  )
}

function SqlSnippetList({
  items,
  emptyLabel,
  onApply,
  onDelete,
  deleteBusy,
}: {
  items: Array<SqlFavoriteEntry | SqlHistoryEntry>
  emptyLabel: string
  onApply: (entry: SqlFavoriteEntry | SqlHistoryEntry) => void
  onDelete?: (entry: SqlFavoriteEntry) => void
  deleteBusy: boolean
}) {
  if (items.length === 0) {
    return <div className="text-[12px] text-description">{emptyLabel}</div>
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,black_4%)] px-2.5 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-[var(--vscode-foreground)]">
                {"label" in item ? item.label : buildDefaultFavoriteLabel(item.sql)}
              </div>
              <div className="truncate text-[11px] text-description">
                {item.targetName || item.targetId || item.connectionType}
                {"executedAt" in item ? ` • ${formatRelativeTime(item.executedAt)}` : ""}
              </div>
            </div>
            <WorkbenchCompactActionCluster>
              <WorkbenchActionButton type="button" variant="secondary" onClick={() => onApply(item)}>
                Use
              </WorkbenchActionButton>
              {onDelete && "label" in item && (
                <WorkbenchActionButton type="button" variant="ghost" onClick={() => onDelete(item)} disabled={deleteBusy}>
                  Delete
                </WorkbenchActionButton>
              )}
            </WorkbenchCompactActionCluster>
          </div>
          {"description" in item && item.description && (
            <div className="mt-1 text-[11px] text-description">{item.description}</div>
          )}
          <pre className="mt-1.5 max-h-[100px] overflow-auto whitespace-pre-wrap rounded-[2px] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,black_6%)] px-2 py-1.5 text-[11px] leading-5 text-[var(--vscode-editor-foreground)]">
            {item.sql}
          </pre>
        </div>
      ))}
    </div>
  )
}

function SqlTargetListItem({
  target,
  selected,
  connected,
  onSelect,
}: {
  target: SqlTarget
  selected: boolean
  connected: boolean
  onSelect: () => void
}) {
  return (
    <WorkbenchInventoryCard
      title={target.name}
      subtitle={target.id}
      details={[target.region || "default", target.lifecycleState || "Unknown"]}
      selected={selected}
      subtle
      onClick={onSelect}
      rightSlot={connected ? <StatusBadge label="Live" tone="success" /> : undefined}
    />
  )
}


function buildDefaultFavoriteLabel(sql: string): string {
  const firstLine = sql.split("\n")[0]?.trim() || "SQL Snippet"
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine
}

function summarizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 96) || "Empty SQL"
}

function formatRelativeTime(isoString: string): string {
  const timestamp = Date.parse(isoString)
  if (Number.isNaN(timestamp)) {
    return isoString
  }
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000))
  if (diffMinutes < 1) {
    return "just now"
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }
  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}
