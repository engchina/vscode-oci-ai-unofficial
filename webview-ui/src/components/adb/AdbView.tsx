import { clsx } from "clsx"
import {
  AlertCircle,
  Database,
  Download,
  Loader2,
  PlayCircle,
  Plug,
  RefreshCw,
  Save,
  Search,
  SquareTerminal,
  StopCircle,
  Trash2,
  Unplug,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type {
  AdbResource,
  ConnectAdbResponse,
  ExecuteAdbSqlResponse,
  LoadAdbConnectionResponse,
  OracleDbDiagnosticsResponse,
} from "../../services/types"
import OracleDiagnosticsPanel from "../common/OracleDiagnosticsPanel"
import Button from "../ui/Button"
import CompartmentSelector from "../ui/CompartmentSelector"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"

type ActionState = { id: string; action: "starting" | "stopping" } | null

const TRANSITIONAL_STATES = new Set([
  "STARTING", "STOPPING", "PROVISIONING", "TERMINATING",
  "RESTARTING", "UPDATING", "UPGRADING", "BACKUP_IN_PROGRESS",
  "RESTORE_IN_PROGRESS", "SCALE_IN_PROGRESS", "MAINTENANCE_IN_PROGRESS",
])
const POLL_INTERVAL_MS = 5000

export default function AdbView() {
  const { activeProfile, profilesConfig, tenancyOcid } = useExtensionState()
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
  const [sqlResult, setSqlResult] = useState<ExecuteAdbSqlResponse | null>(null)
  const [adbBusyAction, setAdbBusyAction] = useState<"wallet" | "connect" | "disconnect" | "execute" | "save" | "delete" | null>(null)
  const [hasSavedProfile, setHasSavedProfile] = useState(false)
  const [diagnostics, setDiagnostics] = useState<OracleDbDiagnosticsResponse | null>(null)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)
  const previousSelectedAdbIdRef = useRef("")

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
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
  }, [selectedAdbId])

  useEffect(() => {
    load()
  }, [load])

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

  const handleStart = useCallback(
    async (id: string, region?: string) => {
      setActionState({ id, action: "starting" })
      try {
        await ResourceServiceClient.startAdb(id, region)
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
        await ResourceServiceClient.stopAdb(id, region)
        await load()
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdbBusyAction(null)
    }
  }, [selectedDatabase])

  const handleDiagnostics = useCallback(async () => {
    setError(null)
    setLoadingDiagnostics(true)
    try {
      const response = await ResourceServiceClient.getOracleDbDiagnostics()
      setDiagnostics(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingDiagnostics(false)
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border-panel px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-panel bg-list-background-hover">
            <Database size={14} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">Autonomous AI Database</span>
            {isPolling ? (
              <span className="text-xs text-warning animate-pulse">Auto-refreshing every 5s...</span>
            ) : (
              <span className="text-xs text-description">Download wallet, connect and run SQL by compartment and region.</span>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          title={isPolling ? "Auto-refreshing every 5s" : "Refresh"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
        </button>
      </div>

      <div className="border-b border-border-panel px-3 pt-3 pb-2 flex flex-col gap-2">
        <CompartmentSelector featureKey="adb" multiple />
        {databases.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-input-border bg-input-background px-2.5 py-1.5">
            <Search size={12} className="shrink-0 text-description" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter databases..."
              className="flex-1 bg-transparent text-xs text-input-foreground outline-none placeholder:text-input-placeholder"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-xs text-error">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && databases.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-description">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-xs">Loading databases...</span>
          </div>
        ) : databases.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-description">
                {filtered.length === databases.length
                  ? `${databases.length} Database${databases.length !== 1 ? "s" : ""}`
                  : `${filtered.length} of ${databases.length} Databases`}
              </h4>
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-xs text-description">No databases match your filter.</p>
              ) : (
                grouped.map((compartmentGroup) => (
                  <div key={compartmentGroup.compartmentId} className="rounded-xl border border-border-panel p-3 sm:p-4">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-description">
                      Compartment: {compartmentNameById.get(compartmentGroup.compartmentId) ?? compartmentGroup.compartmentId}
                    </h5>
                    <div className="mt-3 flex flex-col gap-3">
                      {compartmentGroup.regions.map((regionGroup) => (
                        <div key={`${compartmentGroup.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                          <h6 className="text-[11px] font-semibold uppercase tracking-wider text-description">
                            Region: {regionGroup.region}
                          </h6>
                          {regionGroup.databases.map((db) => (
                            <DatabaseCard
                              key={`${db.id}-${db.region ?? "default"}`}
                              database={db}
                              selected={db.id === selectedAdbId}
                              actionState={actionState}
                              onStart={handleStart}
                              onStop={handleStop}
                              onSelect={setSelectedAdbId}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col gap-3 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)] p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold">ADB SQL Console</h4>
                  <p className="text-xs text-description">
                    Selected: {selectedDatabase?.name ?? "None"}
                  </p>
                </div>
                <span
                  className={clsx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                    connectionId
                      ? "border-success/30 text-success bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,green_18%)]"
                      : "border-border-panel text-description",
                  )}
                >
                  {connectionId ? "Connected" : "Disconnected"}
                </span>
              </div>
              {connectionTarget && (
                <div className="rounded-md border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] px-2.5 py-2 text-[11px] text-description">
                  <div><span className="font-semibold text-foreground">DB:</span> <code>{connectionTarget.autonomousDatabaseId}</code></div>
                  <div><span className="font-semibold text-foreground">Service:</span> <code>{connectionTarget.serviceName}</code></div>
                  <div className="break-all"><span className="font-semibold text-foreground">Wallet:</span> <code>{connectionTarget.walletPath}</code></div>
                </div>
              )}
              <OracleDiagnosticsPanel diagnostics={diagnostics} />

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

              <div className="flex gap-2">
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
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="gap-1.5"
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
                  </Button>
                  {hasSavedProfile && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="gap-1.5 text-error hover:text-error"
                      onClick={handleDeleteConnection}
                      disabled={adbBusyAction !== null}
                    >
                      {adbBusyAction === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Delete
                    </Button>
                  )}
                </div>
              </div>

              <Textarea
                label="SQL"
                value={sql}
                onChange={e => setSql(e.target.value)}
                className="min-h-[100px] font-mono text-xs"
                placeholder="SELECT * FROM your_table FETCH FIRST 20 ROWS ONLY"
              />
              <Button
                type="button"
                size="sm"
                className="w-fit gap-1.5"
                onClick={handleExecuteSql}
                disabled={adbBusyAction !== null || !connectionId || !sql.trim()}
              >
                {adbBusyAction === "execute" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
                Execute SQL
              </Button>

              {sqlResult && (
                <div className="rounded-md border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] p-3">
                  <div className="mb-2 text-xs text-description">{sqlResult.message}</div>
                  {sqlResult.isSelect ? (
                    <div className="max-h-[320px] overflow-auto rounded border border-border-panel">
                      <table className="min-w-full border-collapse text-xs">
                        <thead className="sticky top-0 bg-list-background-hover">
                          <tr>
                            {sqlResult.columns.map((column) => (
                              <th key={column} className="border-b border-border-panel px-2 py-1.5 text-left font-semibold">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sqlResult.rows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={Math.max(sqlResult.columns.length, 1)}
                                className="px-2 py-2 text-description"
                              >
                                No rows
                              </td>
                            </tr>
                          ) : (
                            sqlResult.rows.map((row, index) => (
                              <tr key={`row-${index}`} className="odd:bg-[color-mix(in_srgb,var(--vscode-editor-background)_98%,white_2%)]">
                                {sqlResult.columns.map((column) => (
                                  <td key={`${index}-${column}`} className="border-b border-border-panel/50 px-2 py-1.5 align-top">
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
                    <div className="text-xs text-description">Rows affected: {sqlResult.rowsAffected}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DatabaseCard({
  database,
  selected,
  actionState,
  onStart,
  onStop,
  onSelect,
}: {
  database: AdbResource
  selected: boolean
  actionState: ActionState
  onStart: (id: string, region?: string) => void
  onStop: (id: string, region?: string) => void
  onSelect: (id: string) => void
}) {
  const isActing = actionState?.id === database.id
  const isAvailable = database.lifecycleState === "AVAILABLE"
  const isStopped = database.lifecycleState === "STOPPED"

  return (
    <div
      className={clsx(
        "flex flex-col gap-3 rounded-xl border p-3 sm:p-4",
        selected
          ? "border-button-background bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,var(--vscode-button-background)_10%)]"
          : "border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{database.name}</span>
          <span className="truncate text-xs text-description">{database.id}</span>
        </div>
        <LifecycleBadge state={database.lifecycleState} />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={selected ? "primary" : "secondary"}
          onClick={() => onSelect(database.id)}
        >
          {selected ? "Selected" : "Select"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={isActing || !isStopped}
          onClick={() => onStart(database.id, database.region)}
          className="flex items-center gap-1.5"
        >
          {isActing && actionState?.action === "starting" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <PlayCircle size={12} />
          )}
          Start
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={isActing || !isAvailable}
          onClick={() => onStop(database.id, database.region)}
          className="flex items-center gap-1.5"
        >
          {isActing && actionState?.action === "stopping" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <StopCircle size={12} />
          )}
          Stop
        </Button>
      </div>
    </div>
  )
}

function LifecycleBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    AVAILABLE: "text-success bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,green_20%)] border-success/30",
    STOPPED: "text-description bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] border-border-panel",
    STOPPING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    STARTING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    PROVISIONING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    TERMINATED: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
    UNAVAILABLE: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
  }
  const cls = colorMap[state] ?? "text-description border-border-panel"
  return (
    <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", cls)}>
      {state}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-panel py-16 text-description">
      <Database size={24} className="mb-2 opacity-70" />
      <p className="text-sm">No Autonomous Databases found.</p>
      <p className="mt-1 text-xs">Check your compartment and permissions.</p>
    </div>
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

function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "NULL"
  }
  return String(value)
}
