import { clsx } from "clsx"
import {
  Database,
  Download,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Search,
  SquareTerminal,
  Trash2,
  Unplug,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
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
import Button from "../ui/Button"
import Card from "../ui/Card"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"

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

export default function SqlWorkbenchView() {
  const { sqlWorkbench } = useExtensionState()
  const [targetType, setTargetType] = useState<SqlWorkbenchConnectionType>("adb")
  const [adbTargets, setAdbTargets] = useState<AdbResource[]>([])
  const [dbSystemTargets, setDbSystemTargets] = useState<DbSystemResource[]>([])
  const [targetFilter, setTargetFilter] = useState("")
  const [selectedTargetId, setSelectedTargetId] = useState("")
  const [busyAction, setBusyAction] = useState<BusyAction>("load")
  const [error, setError] = useState<string | null>(null)

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

  const previousTargetKeyRef = useRef("")

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

  useEffect(() => {
    void loadTargets()
  }, [])

  useEffect(() => {
    if (!targets.some((item) => item.id === selectedTargetId)) {
      setSelectedTargetId(targets[0]?.id ?? "")
    }
  }, [selectedTargetId, targets])

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

  async function handleSaveProfile(): Promise<void> {
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

  async function handleDeleteProfile(): Promise<void> {
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

  async function handleSaveFavorite(): Promise<void> {
    const normalizedSql = sql.trim()
    if (!normalizedSql) {
      setError("Enter SQL before saving a favorite.")
      return
    }
    setBusyAction("saveFavorite")
    setError(null)
    try {
      await SqlWorkbenchServiceClient.saveSqlFavorite({
        label: favoriteLabel.trim() || buildDefaultFavoriteLabel(normalizedSql),
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

  async function handleDeleteFavorite(id: string): Promise<void> {
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

  async function handleClearHistory(): Promise<void> {
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

  async function handleAskAssistant(): Promise<void> {
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
    <div className="flex h-full min-h-0 flex-col bg-[var(--vscode-editor-background)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-panel-border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Database size={14} className="text-[var(--vscode-icon-foreground)]" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">SQL Workbench</div>
            <div className="truncate text-[11px] text-description">Query, favorites, explain plan, AI assistant</div>
          </div>
        </div>
        <Button variant="icon" size="icon" onClick={() => void loadTargets()} disabled={busyAction === "load"} title="Refresh targets">
          <RefreshCw size={14} className={clsx(busyAction === "load" && "animate-spin")} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && (
          <div className="mb-3 rounded-[2px] border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Card title="Target">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTargetType("adb")}
                className={clsx(
                  "h-7 flex-1 rounded-[2px] border px-2 text-[12px] font-medium",
                  targetType === "adb"
                    ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "border-input-border bg-input-background text-input-foreground",
                )}
              >
                Autonomous DB
              </button>
              <button
                type="button"
                onClick={() => setTargetType("dbSystem")}
                className={clsx(
                  "h-7 flex-1 rounded-[2px] border px-2 text-[12px] font-medium",
                  targetType === "dbSystem"
                    ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "border-input-border bg-input-background text-input-foreground",
                )}
              >
                DB System
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-[2px] border border-input-border bg-input-background px-2 py-1">
              <Search size={12} className="text-[var(--vscode-icon-foreground)]" />
              <input
                value={targetFilter}
                onChange={(event) => setTargetFilter(event.target.value)}
                placeholder="Filter targets"
                className="flex-1 bg-transparent text-[13px] text-input-foreground outline-none placeholder:text-input-placeholder"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] leading-none text-foreground">Database Target</label>
              <select
                value={selectedTargetId}
                onChange={(event) => setSelectedTargetId(event.target.value)}
                className="h-[30px] rounded-[2px] border border-input-border bg-input-background px-2 text-[13px] text-input-foreground outline-none focus:border-border focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)] focus:-outline-offset-1"
              >
                {filteredTargets.length === 0 && <option value="">No targets available</option>}
                {filteredTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {formatTargetOption(target)}
                  </option>
                ))}
              </select>
            </div>

            {selectedTarget && (
              <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,black_4%)] px-2.5 py-2 text-[11px] text-description">
                <div><span className="text-foreground">Name:</span> {selectedTarget.name}</div>
                <div><span className="text-foreground">Region:</span> {selectedTarget.region || "default"}</div>
                <div><span className="text-foreground">State:</span> {selectedTarget.lifecycleState}</div>
                {connectionSummary && connectionSummary.targetId === selectedTarget.id && (
                  <div className="mt-1 text-success">Connected via {connectionSummary.serviceName}</div>
                )}
              </div>
            )}
          </Card>

          <Card title="Connection">
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
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="w-full gap-1.5"
                      onClick={() => void handleDownloadWallet()}
                      disabled={!selectedTargetId || walletPassword.trim().length < 8 || busyAction !== null}
                    >
                      {busyAction === "wallet" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      Download Wallet
                    </Button>
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

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={() => void handleTestConnection()}
                disabled={!selectedTargetId || !serviceName.trim() || !username.trim() || !password || (targetType === "adb" && (!walletPath.trim() || !walletPassword.trim())) || busyAction !== null}
              >
                {busyAction === "test" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                Test Connection
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => void handleConnect()}
                disabled={!selectedTargetId || !serviceName.trim() || !username.trim() || !password || Boolean(connectionId) || (targetType === "adb" && (!walletPath.trim() || !walletPassword.trim())) || busyAction !== null}
              >
                {busyAction === "connect" ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                Connect
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={() => void handleDisconnect()}
                disabled={!connectionId || busyAction !== null}
              >
                {busyAction === "disconnect" ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                Disconnect
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={() => void handleSaveProfile()}
                disabled={!selectedTargetId || !serviceName.trim() || !username.trim() || busyAction !== null}
              >
                {busyAction === "saveProfile" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {hasSavedProfile ? "Saved" : "Save Profile"}
              </Button>
              {hasSavedProfile && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1.5 text-error hover:text-error"
                  onClick={() => void handleDeleteProfile()}
                  disabled={busyAction !== null}
                >
                  {busyAction === "deleteProfile" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete Profile
                </Button>
              )}
            </div>

            {testResult && (
              <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,green_4%)] px-2.5 py-2 text-[11px] text-description">
                {testResult.message} {testResult.latencyMs > 0 ? `(${testResult.latencyMs} ms)` : ""}
              </div>
            )}
          </Card>

          <Card title="SQL Runner">
            <Textarea
              label="SQL"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              className="min-h-[140px] font-mono text-[12px]"
              placeholder="SELECT * FROM your_table FETCH FIRST 20 ROWS ONLY"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="gap-1.5" onClick={() => void handleRunSql()} disabled={!connectionId || !sql.trim() || busyAction !== null}>
                {busyAction === "execute" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                Run SQL
              </Button>
              <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => void handleExplainPlan()} disabled={!connectionId || !sql.trim() || busyAction !== null}>
                {busyAction === "plan" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                Explain Plan
              </Button>
            </div>

            {sqlResult && <SqlResultPanel result={sqlResult} />}
            {planResult && (
              <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] p-3">
                <div className="mb-2 text-[12px] text-description">{planResult.message}</div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--vscode-editor-foreground)]">
                  {planResult.planLines.join("\n")}
                </pre>
              </div>
            )}
          </Card>

          <Card title="Favorites">
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
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => void handleSaveFavorite()} disabled={!sql.trim() || busyAction !== null}>
                {busyAction === "saveFavorite" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save Current SQL
              </Button>
            </div>
            <SqlSnippetList
              emptyLabel="No favorites yet."
              items={sqlWorkbench.favorites}
              onApply={applySqlSnippet}
              onDelete={(id) => void handleDeleteFavorite(id)}
              deleteBusy={busyAction === "deleteFavorite"}
            />
          </Card>

          <Card title="History">
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => void handleClearHistory()} disabled={sqlWorkbench.history.length === 0 || busyAction !== null}>
                {busyAction === "clearHistory" ? "Clearing..." : "Clear History"}
              </Button>
            </div>
            <SqlSnippetList
              emptyLabel="No SQL history yet."
              items={sqlWorkbench.history}
              onApply={applySqlSnippet}
              deleteBusy={false}
            />
          </Card>

          <Card title="AI SQL Assistant">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAssistantMode("generate")}
                className={clsx(
                  "h-7 flex-1 rounded-[2px] border px-2 text-[12px] font-medium",
                  assistantMode === "generate"
                    ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "border-input-border bg-input-background text-input-foreground",
                )}
              >
                NL to SQL
              </button>
              <button
                type="button"
                onClick={() => setAssistantMode("optimize")}
                className={clsx(
                  "h-7 flex-1 rounded-[2px] border px-2 text-[12px] font-medium",
                  assistantMode === "optimize"
                    ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                    : "border-input-border bg-input-background text-input-foreground",
                )}
              >
                Optimize SQL
              </button>
            </div>
            <Textarea
              label="Prompt"
              value={assistantPrompt}
              onChange={(event) => setAssistantPrompt(event.target.value)}
              className="min-h-[88px]"
              placeholder={assistantMode === "generate" ? "List top 10 tables by segment size." : "Optimize the query for high-cardinality join predicates."}
            />
            <Textarea
              label="Schema Context"
              value={schemaContext}
              onChange={(event) => setSchemaContext(event.target.value)}
              className="min-h-[88px] font-mono text-[12px]"
              placeholder="tables: orders(order_id, customer_id, status, created_at)..."
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" className="gap-1.5" onClick={() => void handleAskAssistant()} disabled={busyAction !== null || (!assistantPrompt.trim() && !sql.trim())}>
                {busyAction === "assistant" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                Ask Assistant
              </Button>
              {assistantResult?.suggestedSql && (
                <Button type="button" size="sm" variant="secondary" onClick={() => setSql(assistantResult.suggestedSql ?? "")}>
                  Use Suggested SQL
                </Button>
              )}
            </div>
            {assistantResult && (
              <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] p-3">
                <pre className="whitespace-pre-wrap text-[11px] leading-5 text-[var(--vscode-editor-foreground)]">{assistantResult.content}</pre>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function SqlResultPanel({ result }: { result: ExecuteAdbSqlResponse }) {
  return (
    <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] p-3">
      <div className="mb-2 text-[12px] text-description">{result.message}</div>
      {result.isSelect ? (
        <div className="max-h-[320px] overflow-auto rounded-[2px] border border-[var(--vscode-panel-border)]">
          <table className="min-w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-[var(--vscode-list-hoverBackground)]">
              <tr>
                {result.columns.map((column) => (
                  <th key={column} className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(result.columns.length, 1)} className="px-2 py-2 text-description">
                    No rows
                  </td>
                </tr>
              ) : (
                result.rows.map((row, index) => (
                  <tr key={`result-row-${index}`} className="odd:bg-[color-mix(in_srgb,var(--vscode-editor-background)_98%,white_2%)]">
                    {result.columns.map((column) => (
                      <td key={`${index}-${column}`} className="border-b border-[var(--vscode-panel-border)]/50 px-2 py-1.5 align-top">
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[12px] text-description">Rows affected: {result.rowsAffected}</div>
      )}
    </div>
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
  onDelete?: (id: string) => void
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
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="secondary" onClick={() => onApply(item)}>
                Use
              </Button>
              {onDelete && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onDelete(item.id)} disabled={deleteBusy}>
                  Delete
                </Button>
              )}
            </div>
          </div>
          {"description" in item && item.description && (
            <div className="mt-1 text-[11px] text-description">{item.description}</div>
          )}
          <pre className="mt-2 max-h-[100px] overflow-auto whitespace-pre-wrap rounded-[2px] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,black_6%)] px-2 py-1.5 text-[11px] leading-5 text-[var(--vscode-editor-foreground)]">
            {item.sql}
          </pre>
        </div>
      ))}
    </div>
  )
}

function formatTargetOption(target: SqlTarget): string {
  const parts = [target.name, target.region, target.lifecycleState].filter((value) => Boolean(value))
  return parts.join(" • ")
}

function buildDefaultFavoriteLabel(sql: string): string {
  const firstLine = sql.split("\n")[0]?.trim() || "SQL Snippet"
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine
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

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL"
  }
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}
