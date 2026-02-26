import { clsx } from "clsx"
import {
    AlertCircle,
    Database,
    Loader2,
    MonitorPlay,
    MonitorStop,
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
import type { DbSystemResource, ConnectDbSystemResponse, ExecuteAdbSqlResponse, LoadDbSystemConnectionResponse } from "../../services/types"
import { DEFAULT_SSH_USERNAME, loadSshConfig, saveSshConfig, type SshConfig } from "../../sshConfig"
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

export default function DbSystemsView() {
    const { activeProfile, profilesConfig, tenancyOcid } = useExtensionState()
    const [dbSystems, setDbSystems] = useState<DbSystemResource[]>([])
    const [selectedDbId, setSelectedDbId] = useState("")
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [actionState, setActionState] = useState<ActionState>(null)
    const [connectingId, setConnectingId] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    const [serviceName, setServiceName] = useState("")
    const [username, setUsername] = useState("PDBADMIN")
    const [password, setPassword] = useState("")
    const [connectionId, setConnectionId] = useState("")
    const [connectionTarget, setConnectionTarget] = useState<Pick<ConnectDbSystemResponse, "dbSystemId" | "serviceName"> | null>(null)
    const [sql, setSql] = useState("SELECT SYSDATE AS CURRENT_TIME FROM DUAL")
    const [sqlResult, setSqlResult] = useState<ExecuteAdbSqlResponse | null>(null)
    const [dbBusyAction, setDbBusyAction] = useState<"connect" | "disconnect" | "execute" | "save" | "delete" | null>(null)
    const [hasSavedProfile, setHasSavedProfile] = useState(false)
    const previousSelectedDbIdRef = useRef("")

    const [connectionStrings, setConnectionStrings] = useState<{ name: string, value: string }[]>([])
    const [loadingStrings, setLoadingStrings] = useState(false)

    // SSH configs
    const [sshConfig, setSshConfig] = useState<SshConfig>(loadSshConfig)
    const [sshUserOverrides, setSshUserOverrides] = useState<Record<string, string>>({})
    const [sshKeyOverrides, setSshKeyOverrides] = useState<Record<string, string>>({})
    const [sshSelectedIp, setSshSelectedIp] = useState<Record<string, string>>({})

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
    }, [selectedDbId])

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

    const isPolling = dbSystems.some(db => TRANSITIONAL_STATES.has(db.lifecycleState))
    useEffect(() => {
        if (!isPolling) return
        const timer = setInterval(load, POLL_INTERVAL_MS)
        return () => clearInterval(timer)
    }, [isPolling, load])

    const handleStart = useCallback(
        async (id: string, region?: string) => {
            setActionState({ id, action: "starting" })
            try {
                await ResourceServiceClient.startDbSystem(id, region)
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
                await ResourceServiceClient.stopDbSystem(id, region)
                await load()
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
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
            } finally {
                setConnectingId(null)
            }
        },
        [sshConfig, sshUserOverrides, sshKeyOverrides],
    )

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
                setUsername(saved.username || "PDBADMIN")
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

    const fetchConnectionStrings = useCallback(async (dbId: string, compartmentId: string, region?: string) => {
        setLoadingStrings(true)
        setConnectionStrings([])
        try {
            const res = await ResourceServiceClient.getDbSystemConnectionStrings({ dbSystemId: dbId, compartmentId, region })
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
            const defaultIp = sys?.publicIp || sys?.privateIp || ""
            const ipHint = defaultIp ? `${defaultIp}:1521/${sys?.name || ""}` : ""
            setServiceName(ipHint)
            setUsername("PDBADMIN")
            setPassword("")
            setHasSavedProfile(false)

            if (activeConnectionId) {
                void disconnectConnection(activeConnectionId)
            }
            void loadSavedProfile(selectedDbId)
            if (sys && sys.compartmentId) {
                void fetchConnectionStrings(selectedDbId, sys.compartmentId, sys.region)
            }
        } else if (!previous) {
            const sys = dbSystems.find(d => d.id === selectedDbId)
            const defaultIp = sys?.publicIp || sys?.privateIp || ""
            const ipHint = defaultIp && !serviceName ? `${defaultIp}:1521/${sys?.name || ""}` : serviceName
            if (!serviceName) setServiceName(ipHint)
            void loadSavedProfile(selectedDbId)
            if (sys && sys.compartmentId) {
                void fetchConnectionStrings(selectedDbId, sys.compartmentId, sys.region)
            }
        }
        previousSelectedDbIdRef.current = selectedDbId
    }, [connectionId, disconnectConnection, loadSavedProfile, selectedDbId, dbSystems, serviceName])

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
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDbBusyAction(null)
        }
    }, [selectedDatabase])

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-border-panel px-4 py-3">
                <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-panel bg-list-background-hover">
                        <Database size={14} />
                    </div>
                    <div className="flex min-w-0 flex-col">
                        <span className="text-sm font-semibold">Oracle Base Database Service</span>
                        {isPolling ? (
                            <span className="text-xs text-warning animate-pulse">Auto-refreshing every 5s...</span>
                        ) : (
                            <span className="text-xs text-description">Manage DB Systems, connect via SSH or SQL.</span>
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
                <CompartmentSelector featureKey="dbSystem" multiple />
                {dbSystems.length > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-input-border bg-input-background px-2.5 py-1.5">
                        <Search size={12} className="shrink-0 text-description" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Filter DB Systems..."
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

                {loading && dbSystems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16 text-description">
                        <Loader2 size={24} className="animate-spin" />
                        <span className="text-xs">Loading DB Systems...</span>
                    </div>
                ) : dbSystems.length === 0 ? (
                    <EmptyState />
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-description">
                                {filtered.length === dbSystems.length
                                    ? `${dbSystems.length} DB System${dbSystems.length !== 1 ? "s" : ""}`
                                    : `${filtered.length} of ${dbSystems.length} DB Systems`}
                            </h4>
                            {filtered.length === 0 ? (
                                <p className="py-8 text-center text-xs text-description">No DB Systems match your filter.</p>
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
                                                    {regionGroup.dbSystems.map((db) => (
                                                        <DatabaseCard
                                                            key={`${db.id}-${db.region ?? "default"}`}
                                                            dbSystem={db}
                                                            selected={db.id === selectedDbId}
                                                            actionState={actionState}
                                                            connectingId={connectingId}
                                                            sshConfig={sshConfig}
                                                            sshUserOverride={sshUserOverrides[db.id] || ""}
                                                            sshKeyOverride={sshKeyOverrides[db.id] || ""}
                                                            selectedIp={sshSelectedIp[db.id] || db.publicIp || db.privateIp || ""}
                                                            onStart={handleStart}
                                                            onStop={handleStop}
                                                            onSelect={setSelectedDbId}
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

                        <div className="flex flex-col gap-3 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,black_5%)] p-3 sm:p-4">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <h4 className="text-sm font-semibold">DB System SQL Console</h4>
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
                                    <div><span className="font-semibold text-foreground">DB:</span> <code>{connectionTarget.dbSystemId}</code></div>
                                    <div><span className="font-semibold text-foreground">Service/Connect String:</span> <code>{connectionTarget.serviceName}</code></div>
                                </div>
                            )}

                            <div className="grid gap-2 sm:grid-cols-2">
                                <Input
                                    label="Connect String / Service Name"
                                    value={serviceName}
                                    onChange={e => setServiceName(e.target.value)}
                                    placeholder="e.g. 10.0.0.2:1521/DBS1.subnet.vcn.oraclevcn.com"
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
                                                <button
                                                    key={cs.name}
                                                    type="button"
                                                    onClick={() => setServiceName(cs.value)}
                                                    className="rounded border border-border-panel bg-input-background hover:bg-list-background-hover px-1.5 py-0.5 text-[10px] text-description transition-colors"
                                                    title={cs.value}
                                                >
                                                    {cs.name}
                                                </button>
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
                                    placeholder="PDBADMIN"
                                />
                                <Input
                                    type="password"
                                    label="Password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Database password"
                                />
                            </div>

                            <div className="flex gap-2">
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
                                <div className="ml-auto flex gap-2">
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
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="secondary"
                                            className="gap-1.5 text-error hover:text-error"
                                            onClick={handleDeleteConnection}
                                            disabled={dbBusyAction !== null}
                                        >
                                            {dbBusyAction === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
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
                                disabled={dbBusyAction !== null || !connectionId || !sql.trim()}
                            >
                                {dbBusyAction === "execute" ? <Loader2 size={12} className="animate-spin" /> : <SquareTerminal size={12} />}
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
    dbSystem,
    selected,
    actionState,
    connectingId,
    sshConfig,
    sshUserOverride,
    sshKeyOverride,
    selectedIp,
    onStart,
    onStop,
    onSelect,
    onConnectSsh,
    onChangeSshSelectedIp,
    onChangeSshUserOverride,
    onChangeSshKeyOverride,
}: {
    dbSystem: DbSystemResource
    selected: boolean
    actionState: ActionState
    connectingId: string | null
    sshConfig: SshConfig
    sshUserOverride: string
    sshKeyOverride: string
    selectedIp: string
    onStart: (id: string, region?: string) => void
    onStop: (id: string, region?: string) => void
    onSelect: (id: string) => void
    onConnectSsh: (sys: DbSystemResource) => void
    onChangeSshSelectedIp: (id: string, ip: string) => void
    onChangeSshUserOverride: (id: string, u: string) => void
    onChangeSshKeyOverride: (id: string, k: string) => void
}) {
    const isActing = actionState?.id === dbSystem.id
    const isAvailable = dbSystem.lifecycleState === "AVAILABLE"
    const isTerminal = dbSystem.lifecycleState === "TERMINATED" || dbSystem.lifecycleState === "FAILED"
    const isConnecting = connectingId === dbSystem.id

    const host = selectedIp
    const defaultUsername = sshConfig.username.trim() || DEFAULT_SSH_USERNAME

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
                    <span className="truncate text-sm font-medium">{dbSystem.name}</span>
                    <span className="truncate text-xs text-description">{dbSystem.id}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="text-[11px] text-description font-semibold">IP:</span>
                        {dbSystem.publicIp && (
                            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-description hover:text-foreground">
                                <input
                                    type="radio"
                                    name={`ip-${dbSystem.id}`}
                                    checked={selectedIp === dbSystem.publicIp}
                                    onChange={() => onChangeSshSelectedIp(dbSystem.id, dbSystem.publicIp!)}
                                    className="accent-button-background h-3 w-3"
                                />
                                <span>{dbSystem.publicIp} (Public)</span>
                            </label>
                        )}
                        {dbSystem.privateIp && (
                            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-description hover:text-foreground">
                                <input
                                    type="radio"
                                    name={`ip-${dbSystem.id}`}
                                    checked={selectedIp === dbSystem.privateIp}
                                    onChange={() => onChangeSshSelectedIp(dbSystem.id, dbSystem.privateIp!)}
                                    className="accent-button-background h-3 w-3"
                                />
                                <span>{dbSystem.privateIp} (Private)</span>
                            </label>
                        )}
                        {!dbSystem.publicIp && !dbSystem.privateIp && (
                            <span className="text-[11px] text-description">None</span>
                        )}
                    </div>

                    <div className="mt-2 flex max-w-[320px] items-center gap-2">
                        <span className="shrink-0 text-[11px] text-description">SSH User</span>
                        <input
                            type="text"
                            value={sshUserOverride}
                            onChange={(e) => onChangeSshUserOverride(dbSystem.id, e.target.value)}
                            placeholder={defaultUsername}
                            className="h-7 min-w-0 flex-1 rounded-md border border-input-border bg-input-background px-2 text-xs outline-none"
                        />
                    </div>
                    <div className="mt-1 flex max-w-[320px] items-center gap-2">
                        <span className="shrink-0 text-[11px] text-description">Identity</span>
                        <input
                            type="text"
                            value={sshKeyOverride}
                            onChange={(e) => onChangeSshKeyOverride(dbSystem.id, e.target.value)}
                            placeholder={sshConfig.privateKeyPath.trim() || "~/.ssh/id_rsa"}
                            className="h-7 min-w-0 flex-1 rounded-md border border-input-border bg-input-background px-2 text-xs outline-none"
                        />
                    </div>

                </div>
                <LifecycleBadge state={dbSystem.lifecycleState} />
            </div>

            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    variant={selected ? "primary" : "secondary"}
                    onClick={() => onSelect(dbSystem.id)}
                >
                    {selected ? "Selected" : "Select"}
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={isActing || isAvailable || isTerminal}
                    onClick={() => onStart(dbSystem.id, dbSystem.region)}
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
                    onClick={() => onStop(dbSystem.id, dbSystem.region)}
                    className="flex items-center gap-1.5"
                >
                    {isActing && actionState?.action === "stopping" ? (
                        <Loader2 size={12} className="animate-spin" />
                    ) : (
                        <StopCircle size={12} />
                    )}
                    Stop
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={!isAvailable || !host}
                    onClick={() => onConnectSsh(dbSystem)}
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
        AVAILABLE: "text-success bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,green_20%)] border-success/30",
        STOPPED: "text-description bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] border-border-panel",
        STOPPING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
        STARTING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
        PROVISIONING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
        TERMINATED: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
        FAILED: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
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
            <p className="text-sm">No DB Systems found.</p>
            <p className="mt-1 text-xs">Check your compartment and permissions.</p>
        </div>
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

function formatCell(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "NULL"
    }
    return String(value)
}
