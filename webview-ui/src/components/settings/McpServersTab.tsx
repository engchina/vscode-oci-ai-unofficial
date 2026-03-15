import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { McpServiceClient } from "../../services/grpc-client"
import type {
  McpServerConfig,
  McpServerState,
  McpTransportType,
} from "../../services/types"
import Card from "../ui/Card"
import InlineNotice from "../ui/InlineNotice"
import Input from "../ui/Input"
import Select from "../ui/Select"
import StatusBadge from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
import Toggle from "../ui/Toggle"
import GuardrailDialog from "../common/GuardrailDialog"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
} from "../workbench/WorkbenchActionButtons"

const TRANSPORT_OPTIONS = [
  { value: "stdio", label: "stdio", description: "Local process" },
  { value: "sse", label: "SSE", description: "Server-Sent Events" },
  { value: "streamableHttp", label: "Streamable HTTP", description: "Bidirectional HTTP" },
]

const STATUS_MAP: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  connected: { label: "Connected", tone: "success" },
  connecting: { label: "Connecting", tone: "warning" },
  disconnected: { label: "Disconnected", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
}

interface ServerFormState {
  name: string
  transportType: McpTransportType
  command: string
  args: string
  cwd: string
  env: string
  url: string
  headers: string
  timeout: string
}

const EMPTY_FORM: ServerFormState = {
  name: "",
  transportType: "stdio",
  command: "",
  args: "",
  cwd: "",
  env: "",
  url: "",
  headers: "",
  timeout: "30",
}

function stringifyJson(value?: Record<string, string>): string {
  if (!value || Object.keys(value).length === 0) {
    return ""
  }

  return JSON.stringify(value, null, 2)
}

function getFormStateFromServer(server: McpServerState): ServerFormState {
  return {
    name: server.name,
    transportType: server.config.transportType,
    command: server.config.command ?? "",
    args: (server.config.args ?? []).join(" "),
    cwd: server.config.cwd ?? "",
    env: stringifyJson(server.config.env),
    url: server.config.url ?? "",
    headers: stringifyJson(server.config.headers),
    timeout: String(server.config.timeout ?? 30),
  }
}

function buildServerConfig(form: ServerFormState, existingConfig?: McpServerConfig): McpServerConfig {
  const config: McpServerConfig = {
    transportType: form.transportType,
    disabled: existingConfig?.disabled ?? false,
    timeout: parseInt(form.timeout, 10) || 30,
    autoApprove: existingConfig?.autoApprove ?? [],
  }

  if (form.transportType === "stdio") {
    config.command = form.command.trim()
    config.args = form.args.trim() ? form.args.trim().split(/\s+/) : []
    if (form.cwd.trim()) {
      config.cwd = form.cwd.trim()
    }
    if (form.env.trim()) {
      try {
        config.env = JSON.parse(form.env) as Record<string, string>
      } catch {}
    }
    return config
  }

  config.url = form.url.trim()
  if (form.headers.trim()) {
    try {
      config.headers = JSON.parse(form.headers) as Record<string, string>
    } catch {}
  }
  return config
}

export default function McpServersTab() {
  const [servers, setServers] = useState<McpServerState[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingServerName, setEditingServerName] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<ServerFormState>(EMPTY_FORM)
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const loadServers = useCallback(async () => {
    try {
      const result = await McpServiceClient.listServers()
      setServers(result.servers)
    } catch {
      setServers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadServers()
    const unsubscribe = McpServiceClient.subscribeToServers({
      onResponse: (data) => {
        if (data?.servers) setServers(data.servers)
      },
      onError: () => {},
      onComplete: () => {},
    })
    return unsubscribe
  }, [loadServers])

  const toggleExpanded = useCallback((name: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const resetForm = useCallback(() => {
    setShowAddForm(false)
    setEditingServerName(null)
    setAddForm(EMPTY_FORM)
  }, [])

  const handleAddServer = useCallback(async () => {
    if (!addForm.name.trim()) return

    setAdding(true)
    try {
      const editingServer = editingServerName
        ? servers.find((server) => server.name === editingServerName)
        : undefined
      const config = buildServerConfig(addForm, editingServer?.config)

      if (editingServerName) {
        await McpServiceClient.updateServer({
          currentName: editingServerName,
          name: addForm.name.trim(),
          config,
        })
      } else {
        await McpServiceClient.addServer({ name: addForm.name.trim(), config })
      }
      resetForm()
    } finally {
      setAdding(false)
    }
  }, [addForm, editingServerName, resetForm, servers])

  const handleEditServer = useCallback((server: McpServerState) => {
    setEditingServerName(server.name)
    setAddForm(getFormStateFromServer(server))
    setShowAddForm(true)
  }, [])

  const handleDeleteServer = useCallback(async (name: string) => {
    await McpServiceClient.removeServer(name)
    setDeleteTarget(null)
  }, [])

  const handleToggleServer = useCallback(async (name: string, enabled: boolean) => {
    await McpServiceClient.toggleServer(name, enabled)
  }, [])

  const handleRestartServer = useCallback(async (name: string) => {
    await McpServiceClient.restartServer(name)
  }, [])

  const handleToggleToolAutoApprove = useCallback(
    async (serverName: string, toolName: string, approved: boolean) => {
      await McpServiceClient.toggleToolAutoApprove({
        serverName,
        toolName,
        approved,
      })
    },
    [],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-description" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title="MCP Servers">
        <div className="text-xs text-description">
          Add Model Context Protocol (MCP) servers to give the chat assistant access to external tools and resources.
        </div>
        <InlineNotice tone="warning" size="sm" icon={<AlertTriangle size={12} />}>
          MCP runtime is now active for connected servers. Prompts can be previewed from chat with <code>/mcp-prompt</code>, and the most OpenClaw-like workflow comes from pairing MCP with Agent Skills and agent mode.
        </InlineNotice>
      </Card>

      {/* Server list */}
      {servers.length === 0 && !showAddForm && (
        <InlineNotice tone="info" size="sm">
          No MCP servers are configured yet. Use the Add Server button below to create one.
        </InlineNotice>
      )}

      {servers.map((server) => {
        const isExpanded = expandedServers.has(server.name)
        const statusInfo = STATUS_MAP[server.status] ?? STATUS_MAP.disconnected
        const isEnabled = !server.config.disabled
        const autoApproveSet = new Set(server.config.autoApprove ?? [])

        return (
          <Card key={server.name} title={server.name}>
            <div className="flex flex-col gap-3">
              {/* Status + Controls */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge label={statusInfo.label} tone={statusInfo.tone} />
                  <span className="text-xs text-description">{server.config.transportType}</span>
                </div>
                <WorkbenchCompactActionCluster>
                  <button
                    className="p-1 text-description hover:text-foreground"
                    title="Edit"
                    onClick={() => handleEditServer(server)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="p-1 text-description hover:text-foreground"
                    title="Restart"
                    onClick={() => handleRestartServer(server.name)}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    className="p-1 text-description hover:text-[var(--vscode-errorForeground)]"
                    title="Delete"
                    onClick={() => setDeleteTarget(server.name)}
                  >
                    <Trash2 size={14} />
                  </button>
                </WorkbenchCompactActionCluster>
              </div>

              {/* Enable/Disable toggle */}
              <Toggle
                checked={isEnabled}
                onChange={(checked) => handleToggleServer(server.name, checked)}
                label="Enabled"
                description="Turn this server on or off."
              />

              {/* Connection info */}
              <div className="text-xs text-description">
                {server.config.transportType === "stdio" ? (
                  <span>
                    Command: <code className="text-foreground">{server.config.command} {(server.config.args ?? []).join(" ")}</code>
                    {server.config.cwd ? (
                      <>
                        {" "}in <code className="text-foreground">{server.config.cwd}</code>
                      </>
                    ) : null}
                  </span>
                ) : (
                  <span>URL: <code className="text-foreground">{server.config.url}</code></span>
                )}
              </div>

              {/* Error display */}
              {server.error && (
                <InlineNotice tone="danger" size="sm" icon={<AlertTriangle size={12} />}>
                  {server.error}
                </InlineNotice>
              )}

              {/* Expandable tools section */}
              <button
                className="flex items-center gap-1 text-xs text-description hover:text-foreground"
                onClick={() => toggleExpanded(server.name)}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Wrench size={12} />
                <span>Tools ({server.tools.length})</span>
              </button>

              {isExpanded && (
                <div className="ml-4 flex flex-col gap-2">
                  {server.tools.length === 0 ? (
                    <span className="text-xs text-description italic">No tools discovered</span>
                  ) : (
                    server.tools.map((tool) => (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between gap-2 rounded border border-[var(--vscode-panel-border)] px-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-medium">{tool.name}</span>
                          {tool.description && (
                            <span className="ml-2 text-xs text-description">{tool.description}</span>
                          )}
                        </div>
                        <label className="flex items-center gap-1 text-xs text-description whitespace-nowrap">
                          <input
                            type="checkbox"
                            className="accent-[var(--vscode-checkbox-foreground)]"
                            checked={autoApproveSet.has(tool.name)}
                            onChange={(e) =>
                              handleToggleToolAutoApprove(server.name, tool.name, e.target.checked)
                            }
                          />
                          Auto
                        </label>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </Card>
        )
      })}

      {/* Add Server Form */}
      {showAddForm ? (
        <Card title={editingServerName ? `Edit MCP Server: ${editingServerName}` : "Add MCP Server"}>
          <div className="flex flex-col gap-3">
            <Input
              label="Server Name"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="my-mcp-server"
            />

            <Select
              label="Transport Type"
              options={TRANSPORT_OPTIONS}
              value={addForm.transportType}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, transportType: e.target.value as McpTransportType }))
              }
            />

            {addForm.transportType === "stdio" ? (
              <>
                <Input
                  label="Command"
                  value={addForm.command}
                  onChange={(e) => setAddForm((f) => ({ ...f, command: e.target.value }))}
                  placeholder="node, python, npx..."
                />
                <Input
                  label="Arguments"
                  value={addForm.args}
                  onChange={(e) => setAddForm((f) => ({ ...f, args: e.target.value }))}
                  placeholder="server.js --port 3000"
                />
                <Input
                  label="Working Directory"
                  value={addForm.cwd}
                  onChange={(e) => setAddForm((f) => ({ ...f, cwd: e.target.value }))}
                  placeholder="/absolute/path/to/server"
                />
                <Textarea
                  label="Environment Variables (JSON)"
                  value={addForm.env}
                  onChange={(e) => setAddForm((f) => ({ ...f, env: e.target.value }))}
                  placeholder='{"API_KEY": "xxx"}'
                  rows={2}
                />
              </>
            ) : (
              <>
                <Input
                  label="URL"
                  value={addForm.url}
                  onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/mcp"
                />
                <Textarea
                  label="Headers (JSON)"
                  value={addForm.headers}
                  onChange={(e) => setAddForm((f) => ({ ...f, headers: e.target.value }))}
                  placeholder='{"Authorization": "Bearer xxx"}'
                  rows={2}
                />
              </>
            )}

            <Input
              label="Timeout (seconds)"
              type="number"
              value={addForm.timeout}
              onChange={(e) => setAddForm((f) => ({ ...f, timeout: e.target.value }))}
              placeholder="30"
            />

            <WorkbenchCompactActionCluster>
              <WorkbenchActionButton
                variant="primary"
                onClick={handleAddServer}
                disabled={!addForm.name.trim() || adding}
              >
                {adding ? <Loader2 size={14} className="animate-spin" /> : editingServerName ? <Pencil size={14} /> : <Plus size={14} />}
                {editingServerName ? "Save" : "Add"}
              </WorkbenchActionButton>
              <WorkbenchActionButton
                variant="secondary"
                onClick={resetForm}
              >
                Cancel
              </WorkbenchActionButton>
            </WorkbenchCompactActionCluster>
          </div>
        </Card>
      ) : (
        <WorkbenchActionButton
          variant="secondary"
          onClick={() => {
            setEditingServerName(null)
            setAddForm(EMPTY_FORM)
            setShowAddForm(true)
          }}
        >
          <Plus size={14} />
          Add Server
        </WorkbenchActionButton>
      )}

      {/* Delete confirmation dialog */}
      <GuardrailDialog
        open={deleteTarget !== null}
        title="Delete MCP Server"
        description={`Delete the server "${deleteTarget ?? ""}"? This action cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => { if (deleteTarget) handleDeleteServer(deleteTarget) }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
