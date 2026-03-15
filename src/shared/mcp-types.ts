/** MCP (Model Context Protocol) shared types */

export type McpTransportType = "stdio" | "sse" | "streamableHttp";

export interface McpServerConfig {
  /** Transport type */
  transportType: McpTransportType;
  /** Command to execute (stdio) */
  command?: string;
  /** Command arguments (stdio) */
  args?: string[];
  /** Working directory (stdio) */
  cwd?: string;
  /** Environment variables (stdio) */
  env?: Record<string, string>;
  /** Server URL (sse/streamableHttp) */
  url?: string;
  /** HTTP headers (sse/streamableHttp) */
  headers?: Record<string, string>;
  /** Whether server is disabled */
  disabled?: boolean;
  /** Request timeout in seconds */
  timeout?: number;
  /** Allowlist entries for auto-approved MCP actions */
  autoApprove?: string[];
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

export interface McpServerState {
  name: string;
  config: McpServerConfig;
  status: McpServerStatus;
  error?: string;
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  prompts: McpPromptInfo[];
}

/** Request to add/update an MCP server */
export interface AddMcpServerRequest {
  name: string;
  config: McpServerConfig;
}

/** Request to edit an existing MCP server, optionally renaming it */
export interface UpdateMcpServerRequest {
  currentName: string;
  name: string;
  config: McpServerConfig;
}

/** Request to toggle a tool's auto-approve */
export interface ToggleMcpToolAutoApproveRequest {
  serverName: string;
  toolName: string;
  approved: boolean;
}

/** Agent mode */
export type AgentMode = "chat" | "agent";

export type AgentSkillSource = "bundled" | "workspace" | "user" | "extra";

export interface AgentSkillConfigEntry {
  enabled?: boolean;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface AgentSkillsConfig {
  entries?: Record<string, AgentSkillConfigEntry>;
  load?: {
    extraDirs?: string[];
    watch?: boolean;
    watchDebounceMs?: number;
    includeBundled?: boolean;
    includeWorkspace?: boolean;
    includeUser?: boolean;
  };
}

export interface AgentSkillSummary {
  id: string;
  name: string;
  description?: string;
  source: AgentSkillSource;
  directory: string;
  filePath: string;
  homepage?: string;
  instructionsPreview?: string;
  configuredEnabled?: boolean;
  enabled: boolean;
  effectiveEnabled: boolean;
  userInvocable: boolean;
  modelInvocable: boolean;
  slashCommandName?: string;
  commandDispatch?: "tool";
  commandTool?: string;
  commandArgMode?: "raw";
  gatingReasons: string[];
}

export interface AgentSkillsState {
  skills: AgentSkillSummary[];
  watched: boolean;
  sources: {
    bundledDir?: string;
    workspaceDirs: string[];
    userDirs: string[];
    extraDirs: string[];
  };
}

/** Tool category auto-approval settings */
export interface AgentAutoApprovalSettings {
  readFiles: boolean;
  writeFiles: boolean;
  executeCommands: boolean;
  webSearch: boolean;
  mcpTools: boolean;
}

/** Agent settings */
export interface AgentSettings {
  mode: AgentMode;
  autoApproval: AgentAutoApprovalSettings;
  maxAutoActions: number;
  enabledTools: AgentEnabledTools;
}

/** Which built-in tools are enabled */
export interface AgentEnabledTools {
  readFile: boolean;
  writeFile: boolean;
  executeCommand: boolean;
  webSearch: boolean;
  browserAction: boolean;
}

/** Tool call data within a chat message */
export interface ToolCallData {
  id: string;
  toolName: string;
  /** MCP server name (for MCP tools) */
  serverName?: string;
  createdAt?: string;
  updatedAt?: string;
  actionKind?: "tool" | "prompt" | "resource";
  actionTarget?: string;
  subagentId?: string;
  subagentLabel?: string;
  attemptCount?: number;
  parameters: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "error";
  result?: ToolCallResult;
}

export interface ToolCallResult {
  content: ToolCallContent[];
  isError?: boolean;
}

export interface ToolCallContent {
  type: "text" | "image" | "resource";
  text?: string;
  dataUrl?: string;
  uri?: string;
  mimeType?: string;
}

export interface McpPromptMessageData {
  role: "user" | "assistant";
  content: ToolCallContent[];
}

/** Extended chat message with tool call support */
export interface ChatMessageToolCalls {
  toolCalls?: ToolCallData[];
}

/** Tool approval request sent to webview */
export interface ToolApprovalRequest {
  callId: string;
  toolName: string;
  serverName?: string;
  parameters: Record<string, unknown>;
}

/** Tool approval response from webview */
export interface ToolApprovalResponse {
  callId: string;
  approved: boolean;
  alwaysAllow?: boolean;
}

export interface McpSmokeTestStep {
  label: string;
  detail?: string;
  status: "info" | "success" | "error";
}

export interface McpSmokeTestResult {
  ok: boolean;
  startedAt: string;
  durationMs: number;
  transportType: McpTransportType;
  capabilities: {
    tools: number;
    resources: number;
    prompts: number;
  };
  toolResultSummary?: string;
  resourceResultSummary?: string;
  promptResultSummary?: string;
  error?: string;
  steps: McpSmokeTestStep[];
}

export interface McpPromptPreviewRequest {
  serverName: string;
  promptName: string;
  args?: Record<string, string>;
}

export interface McpPromptPreviewResponse {
  serverName: string;
  promptName: string;
  args: Record<string, string>;
  description?: string;
  messages: McpPromptMessageData[];
  previewText: string;
}

export interface McpResourcePreviewRequest {
  serverName: string;
  uri: string;
}

export interface McpResourcePreviewResponse {
  serverName: string;
  uri: string;
  result: ToolCallResult;
  previewText: string;
}
