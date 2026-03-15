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

export type AgentSkillInstallKind = "brew" | "node" | "go" | "uv" | "download";
export type AgentSkillImportScope = "workspace" | "user";
export type AgentSkillSuppressionScope = "rule" | "file" | "rule-file";

export interface AgentSkillSuppression {
  scope: AgentSkillSuppressionScope;
  ruleId?: string;
  file?: string;
  note?: string;
  createdAt?: string;
}

export interface AgentSkillConfigEntry {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
}

export interface AgentSkillsConfig {
  entries?: Record<string, AgentSkillConfigEntry>;
  allowBundled?: string[];
  suppressions?: AgentSkillSuppression[];
  load?: {
    extraDirs?: string[];
    watch?: boolean;
    watchDebounceMs?: number;
    includeBundled?: boolean;
    includeWorkspace?: boolean;
    includeUser?: boolean;
  };
  install?: {
    preferBrew?: boolean;
    nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
  };
}

export interface AgentSkillInstallSpec {
  id?: string;
  kind: AgentSkillInstallKind;
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
}

export interface AgentSkillInstallResult {
  ok: boolean;
  skillId: string;
  installerId?: string;
  installerKind?: AgentSkillInstallKind;
  message: string;
  stdout: string;
  stderr: string;
  code: number | null;
  warnings: string[];
  targetPath?: string;
  executedCommand?: string[];
  blockedBySecurity?: boolean;
}

export interface AgentSkillImportResult {
  ok: boolean;
  source: string;
  scope: AgentSkillImportScope;
  message: string;
  warnings: string[];
  importedSkillId?: string;
  importedSkillName?: string;
  targetRoot?: string;
  targetDirectory?: string;
  resolvedSourcePath?: string;
  replacedExisting?: boolean;
  blockedBySecurity?: boolean;
}

export interface AgentSkillImportPickerResult {
  cancelled: boolean;
  path?: string;
}

export interface AgentSkillConfigCheck {
  path: string;
  satisfied: boolean;
}

export interface AgentSkillDiagnosticIssue {
  label: string;
  count: number;
}

export interface AgentSkillSecurityRuleInfo {
  ruleId: string;
  severity: "info" | "warn" | "critical";
  message: string;
  recommendation: string;
}

export interface AgentSkillSecurityRuleStat {
  ruleId: string;
  count: number;
}

export interface AgentSkillSecurityRuleSummary {
  ruleId: string;
  severity: "info" | "warn" | "critical";
  message: string;
  recommendation: string;
  count: number;
  suppressedCount: number;
  matchingSuppressions: AgentSkillSuppression[];
}

export interface AgentSkillSuppressionSummary {
  suppression: AgentSkillSuppression;
  affectedFindings: number;
  affectedSkills: string[];
}

export interface AgentSkillFindingLocationRequest {
  file: string;
  line: number;
}

export interface AgentSkillFindingLocationResponse {
  opened: boolean;
  file: string;
  line: number;
}

export type AgentSkillSecurityScanStatus = "pending" | "ready" | "error";

export interface AgentSkillSecurityFinding {
  ruleId: string;
  severity: "info" | "warn" | "critical";
  file: string;
  line: number;
  message: string;
  evidence: string;
  recommendation: string;
}

export interface AgentSkillSecuritySummary {
  status: AgentSkillSecurityScanStatus;
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  suppressed: number;
  findings: AgentSkillSecurityFinding[];
  error?: string;
}

export interface AgentSkillsDiagnosticReport {
  generatedAt: string;
  counts: {
    total: number;
    ready: number;
    missing: number;
    allowlistBlocked: number;
    disabled: number;
    installableFixes: number;
    securityFlagged: number;
    securityCritical: number;
    securitySuppressed: number;
  };
  topIssues: AgentSkillDiagnosticIssue[];
  securityRules: AgentSkillSecurityRuleInfo[];
  securityRuleStats: AgentSkillSecurityRuleStat[];
  securityRuleSummary: AgentSkillSecurityRuleSummary[];
  suppressions: AgentSkillSuppression[];
  suppressionSummary: AgentSkillSuppressionSummary[];
  buckets: {
    ready: string[];
    missing: string[];
    allowlistBlocked: string[];
    disabled: string[];
    installableFixes: string[];
    securityFlagged: string[];
  };
}

export interface AgentSkillsOverview {
  state: AgentSkillsState;
  diagnostics: AgentSkillsDiagnosticReport;
}

export interface AgentSkillInfoReport {
  generatedAt: string;
  skill: AgentSkillSummary;
}

export interface AgentSkillsCheckReport {
  generatedAt: string;
  diagnostics: AgentSkillsDiagnosticReport;
  sections: {
    ready: AgentSkillSummary[];
    missing: AgentSkillSummary[];
    allowlistBlocked: AgentSkillSummary[];
    disabled: AgentSkillSummary[];
    installableFixes: AgentSkillSummary[];
    securityFlagged: AgentSkillSummary[];
  };
}

export interface AgentSkillSummary {
  id: string;
  skillKey: string;
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
  primaryEnv?: string;
  always: boolean;
  blockedByAllowlist: boolean;
  installers: AgentSkillInstallSpec[];
  preferredInstallerId?: string;
  security: AgentSkillSecuritySummary;
  missing: {
    os: string[];
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
  };
  configChecks: AgentSkillConfigCheck[];
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

// ---------------------------------------------------------------------------
// Bootstrap files (agent personality / workspace context)
// ---------------------------------------------------------------------------

/** Names of all known bootstrap files, in load order. */
export const BOOTSTRAP_FILE_NAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
] as const;

export type BootstrapFileName = (typeof BOOTSTRAP_FILE_NAMES)[number];

export interface BootstrapFile {
  /** Canonical filename (e.g. "SOUL.md") */
  name: BootstrapFileName;
  /** Absolute path on disk */
  path: string;
  /** File content (empty string if file is missing) */
  content: string;
  /** Whether the file exists on disk */
  exists: boolean;
}

export interface BootstrapState {
  /** Directory where bootstrap files live (workspace root / .oci-ai) */
  directory: string;
  /** Loaded bootstrap files */
  files: BootstrapFile[];
  /** Whether this is a brand-new workspace (BOOTSTRAP.md still exists) */
  isBrandNew: boolean;
}
