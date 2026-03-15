/** Re-export shared types for webview consumption.
 *  These mirror the extension-side types in src/shared/services.ts
 *  but are self-contained so the webview bundle doesn't import from extension code.
 */

export interface ChatImageData {
  /** Data URL, e.g. data:image/png;base64,... */
  dataUrl: string
  /** Optional lightweight preview data URL for UI rendering. */
  previewDataUrl?: string
  mimeType: string
  name?: string
}

export interface ChatMessageData {
  role: "user" | "model"
  text: string
  /** Optional image attachments (currently user messages). */
  images?: ChatImageData[]
  /** Optional tool calls (model messages in agent mode). */
  toolCalls?: ToolCallData[]
}

export interface ProfileConfig {
  name: string
  compartments: SavedCompartment[]
}

export type SqlWorkbenchConnectionType = "adb" | "dbSystem"

export interface SqlHistoryEntry {
  id: string
  sql: string
  executedAt: string
  connectionType: SqlWorkbenchConnectionType
  targetId?: string
  targetName?: string
  serviceName?: string
  username?: string
}

export interface SqlFavoriteEntry {
  id: string
  label: string
  sql: string
  description?: string
  connectionType?: SqlWorkbenchConnectionType
  targetId?: string
  targetName?: string
}

export interface SqlWorkbenchState {
  history: SqlHistoryEntry[]
  favorites: SqlFavoriteEntry[]
}

export interface AppState {
  activeProfile: string
  agentMode: AgentMode
  region: string
  compartmentId: string
  computeCompartmentIds: string[]
  chatCompartmentId: string
  adbCompartmentIds: string[]
  dbSystemCompartmentIds: string[]
  vcnCompartmentIds: string[]
  objectStorageCompartmentIds: string[]
  bastionCompartmentIds: string[]
  speechCompartmentIds: string[]
  profilesConfig: ProfileConfig[]
  tenancyOcid: string
  genAiRegion: string
  genAiLlmModelId: string
  assistantModelNames: string
  genAiEmbeddingModelId: string
  chatMessages: ChatMessageData[]
  subagents: SubagentRunData[]
  isStreaming: boolean
  configWarning: string
  sqlWorkbench: SqlWorkbenchState
}

export type SubagentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
export type SubagentLogKind = "lifecycle" | "user" | "assistant" | "steer" | "tool" | "approval" | "error"

export interface SubagentLogEntryData {
  timestamp: string
  kind: SubagentLogKind
  message: string
}

export interface SubagentRunData {
  id: string
  shortId: string
  agentId: string
  task: string
  modelName?: string
  status: SubagentRunStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  transcriptPath: string
  steeringNotes: string[]
  resultText?: string
  errorText?: string
  runtimeMs?: number
  generation: number
  completedGeneration?: number
  announcedGeneration?: number
  processing: boolean
  messageCount: number
  pendingApprovalCount: number
  logs: SubagentLogEntryData[]
}

export interface SubagentMessageRequest {
  runId: string
  message: string
}

export interface SubagentKillRequest {
  runId: string
}

export interface SubagentTranscriptRequest {
  runId: string
}

export interface SubagentTranscriptResponse {
  runId: string
  transcriptPath: string
  transcript: string
  updatedAt?: string
}

export interface SaveSettingsRequest {
  activeProfile: string
  agentMode: AgentMode
  editingProfile?: string
  region: string
  compartmentId: string
  computeCompartmentIds: string[]
  chatCompartmentId: string
  adbCompartmentIds: string[]
  dbSystemCompartmentIds: string[]
  vcnCompartmentIds: string[]
  objectStorageCompartmentIds: string[]
  bastionCompartmentIds: string[]
  speechCompartmentIds?: string[]
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase: string
  systemPrompt: string


  shellIntegrationTimeoutSec: number
  chatMaxTokens: number
  chatTemperature: number
  chatTopP: number
  mcpFetchAutoPaginationMaxHops: number
  mcpFetchAutoPaginationMaxTotalChars: number

  suppressNotification?: boolean
}

export interface DeleteProfileRequest {
  profile: string
}

export interface SavedCompartment {
  name: string
  id: string
}

export interface SettingsState extends SaveSettingsRequest {
  /** Indicates which authentication method is currently active */
  authMode: "api-key"
  /** Named compartments saved for quick switching */
  savedCompartments: SavedCompartment[]
  profilesConfig: ProfileConfig[]
  extensionVersion: string
  extensionDescription: string
}

export interface ProfileSecretsResponse {
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase: string
  region: string
  authMode: "api-key"
}

export interface SendMessageRequest {
  text: string
  images?: ChatImageData[]
  /** Optional model override selected in chat UI. */
  modelName?: string
}

export interface StreamTokenResponse {
  token: string
  done: boolean
}

export interface DownloadAdbWalletRequest {
  autonomousDatabaseId: string
  walletPassword: string
  region?: string
}

export interface DownloadAdbWalletResponse {
  walletPath: string
  serviceNames: string[]
}

export interface ConnectAdbRequest {
  autonomousDatabaseId: string
  walletPath: string
  walletPassword?: string
  username: string
  password: string
  serviceName: string
}

export interface ConnectAdbResponse {
  connectionId: string
  autonomousDatabaseId: string
  serviceName: string
  walletPath: string
}

export interface ConnectComputeSshRequest {
  instanceId: string
  instanceName?: string
  host: string
  username: string
  port?: number
  privateKeyPath?: string
  disableHostKeyChecking?: boolean
}

export interface ConnectComputeSshResponse {
  launched: boolean
}

export interface AdbSqlRow {
  [column: string]: string | number | boolean | null
}

export interface ExecuteAdbSqlRequest {
  connectionId: string
  sql: string
  connectionType?: SqlWorkbenchConnectionType
  targetId?: string
  targetName?: string
  serviceName?: string
  username?: string
}

export interface ExecuteAdbSqlResponse {
  isSelect: boolean
  columns: string[]
  rows: AdbSqlRow[]
  rowsAffected: number
  message: string
}

export interface ExplainSqlPlanRequest {
  connectionId: string
  sql: string
  connectionType?: SqlWorkbenchConnectionType
  targetId?: string
  targetName?: string
  serviceName?: string
  username?: string
}

export interface ExplainSqlPlanResponse {
  planLines: string[]
  message: string
}

export interface TestSqlConnectionResponse {
  success: boolean
  message: string
  latencyMs: number
}

export interface SaveSqlFavoriteRequest {
  id?: string
  label: string
  sql: string
  description?: string
  connectionType?: SqlWorkbenchConnectionType
  targetId?: string
  targetName?: string
}

export interface DeleteSqlFavoriteRequest {
  id: string
}

export type SqlAssistantMode = "generate" | "optimize"

export interface SqlAssistantRequest {
  mode: SqlAssistantMode
  prompt: string
  sql?: string
  schemaContext?: string
  connectionType?: SqlWorkbenchConnectionType
  targetName?: string
}

export interface SqlAssistantResponse {
  content: string
  suggestedSql?: string
}

export type ResourceState = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING" | "UNKNOWN"

export interface ComputeResource {
  id: string
  name: string
  lifecycleState: ResourceState | string
  compartmentId?: string
  region?: string
  publicIp?: string
  privateIp?: string
  subnetId?: string
  vcnId?: string
}

export interface AdbResource {
  id: string
  name: string
  lifecycleState: ResourceState | string
  compartmentId?: string
  region?: string
}

export interface DbSystemResource {
  id: string
  name: string
  lifecycleState: ResourceState | string
  nodeLifecycleState?: string
  compartmentId?: string
  region?: string
  publicIp?: string
  privateIp?: string
  connectString?: string
  subnetId?: string
  vcnId?: string
}

export interface VcnResource {
  id: string;
  name: string;
  lifecycleState: string;
  compartmentId: string;
  region: string;
  cidrBlocks: string[];
}

export interface SecurityRule {
  isStateless: boolean;
  protocol: string;
  source?: string;
  destination?: string;
  description?: string;
  tcpOptions?: {
    destinationPortRange?: { min: number; max: number };
    sourcePortRange?: { min: number; max: number };
  };
  udpOptions?: {
    destinationPortRange?: { min: number; max: number };
    sourcePortRange?: { min: number; max: number };
  };
  icmpOptions?: {
    type: number;
    code?: number;
  };
}

export interface SecurityListResource {
  id: string;
  name: string;
  lifecycleState: string;
  compartmentId: string;
  vcnId: string;
  region: string;
  ingressSecurityRules: SecurityRule[];
  egressSecurityRules: SecurityRule[];
}

export interface ObjectStorageBucketResource {
  name: string
  compartmentId: string
  namespaceName: string
  region: string
  storageTier?: string
  publicAccessType?: string
  approximateCount?: number
  approximateSize?: number
  createdAt?: string
}

export interface ObjectStorageObjectResource {
  name: string
  size?: number
  etag?: string
  md5?: string
  storageTier?: string
  archivalState?: string
  timeCreated?: string
  timeModified?: string
}

export interface ListComputeResponse {
  instances: ComputeResource[]
}

export interface ListAdbResponse {
  databases: AdbResource[]
}

export interface ListDbSystemsResponse {
  dbSystems: DbSystemResource[]
}

export interface ConnectDbSystemRequest {
  dbSystemId: string
  username: string
  password?: string
  serviceName: string
}

export interface ConnectDbSystemResponse {
  connectionId: string
  dbSystemId: string
  serviceName: string
}

export interface ConnectDbSystemSshRequest {
  dbSystemId: string
  dbSystemName?: string
  host: string
  username: string
  port?: number
  privateKeyPath?: string
  disableHostKeyChecking?: boolean
}

export interface ConnectDbSystemSshResponse {
  launched: boolean
}

export interface ExecuteDbSystemSqlRequest {
  connectionId: string
  sql: string
  connectionType?: SqlWorkbenchConnectionType
  targetId?: string
  targetName?: string
  serviceName?: string
  username?: string
}

export interface SaveDbSystemConnectionRequest {
  dbSystemId: string
  username: string
  password?: string
  serviceName: string
}

export interface LoadDbSystemConnectionResponse {
  dbSystemId: string
  username: string
  password?: string
  serviceName: string
}

export interface DbSystemConnectionString {
  name: string;
  value: string;
}

export interface GetDbSystemConnectionStringsRequest {
  dbSystemId: string;
  compartmentId: string;
  region?: string;
  publicIp?: string;
}

export interface GetDbSystemConnectionStringsResponse {
  connectionStrings: DbSystemConnectionString[];
}

export interface OracleDbDiagnosticsResponse {
  requestedMode: "auto" | "thin" | "thick";
  effectiveMode: "thin" | "thick";
  thin: boolean;
  oracleClientVersionString?: string;
  configuredLibDir?: string;
  recommendedOracleClientLibDir: string;
  initError?: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  isWsl: boolean;
  wslDistro?: string;
  timestamp: string;
}


export interface ListVcnResponse {
  vcns: VcnResource[];
}

export interface ListSecurityListRequest {
  vcnId: string;
  region?: string;
}

export interface ListSecurityListResponse {
  securityLists: SecurityListResource[];
}

export interface ListObjectStorageBucketsResponse {
  buckets: ObjectStorageBucketResource[]
}

export interface ListObjectStorageObjectsRequest {
  namespaceName: string
  bucketName: string
  region?: string
  prefix?: string
  recursive?: boolean
}

export interface ListObjectStorageObjectsResponse {
  prefixes: string[]
  objects: ObjectStorageObjectResource[]
}

export interface UploadObjectStorageObjectRequest {
  namespaceName: string
  bucketName: string
  region?: string
  objectName?: string
  prefix?: string
}

export interface UploadObjectStorageObjectResponse {
  objectName: string
  objectSize?: number
  cancelled?: boolean
}

export interface DownloadObjectStorageObjectRequest {
  namespaceName: string
  bucketName: string
  objectName: string
  region?: string
}

export interface DownloadObjectStorageObjectResponse {
  cancelled?: boolean
}

export interface ReadObjectStorageObjectTextRequest {
  namespaceName: string
  bucketName: string
  objectName: string
  region?: string
  maxBytes?: number
}

export interface ReadObjectStorageObjectTextResponse {
  text: string
  truncated?: boolean
}

export interface DeleteObjectStorageObjectRequest {
  namespaceName: string
  bucketName: string
  objectName: string
  region?: string
}

export interface CreateObjectStorageParRequest {
  namespaceName: string
  bucketName: string
  objectName: string
  region?: string
  expiresInHours?: number
}

export interface CreateObjectStorageParResponse {
  accessType: string
  accessUri: string
  fullUrl: string
  objectName: string
  timeExpires: string
}

export interface UpdateSecurityListRequest {
  securityListId: string;
  region?: string;
  ingressSecurityRules: SecurityRule[];
  egressSecurityRules: SecurityRule[];
}

export interface CreateSecurityListRequest {
  vcnId: string;
  compartmentId: string;
  name: string;
  region?: string;
  ingressSecurityRules: SecurityRule[];
  egressSecurityRules: SecurityRule[];
}

export interface DeleteSecurityListRequest {
  securityListId: string;
  region?: string;
}

/** Non-sensitive ADB connection profile stored in VSCode config */
export interface AdbConnectionProfile {
  autonomousDatabaseId: string
  walletPath: string
  username: string
  serviceName: string
}

/** Request to save an ADB connection (includes sensitive fields) */
export interface SaveAdbConnectionRequest extends AdbConnectionProfile {
  walletPassword: string
  password: string
}

/** Response when loading a saved ADB connection */
export interface LoadAdbConnectionResponse extends AdbConnectionProfile {
  walletPassword: string
  password: string
}

export interface CodeContextPayload {
  code: string
  filename: string
  language: string
  /** When set, the webview auto-sends this prompt along with the code block */
  prompt?: string
}

export interface BastionResource {
  id: string
  name: string
  lifecycleState: string
  compartmentId: string
  region: string
  targetVcnId?: string
  targetSubnetId?: string
  clientCidrBlockAllowList?: string[]
  dnsProxyStatus?: string
}

export interface BastionSessionResource {
  id: string
  name: string
  lifecycleState: string
  bastionId: string
  targetResourceDetails?: any
  keyDetails?: any
  sessionTtlInSeconds?: number
  sshMetadata?: Record<string, string>
}

export interface ListBastionsResponse {
  bastions: BastionResource[]
}

export interface ListBastionSessionsRequest {
  bastionId: string
  region?: string
}

export interface ListBastionSessionsResponse {
  sessions: BastionSessionResource[]
}

export interface ListBastionTargetInstancesRequest {
  compartmentIds: string[]
  region?: string
  vcnId?: string
  lifecycleStates?: string[]
}

export interface ListBastionTargetInstancesResponse {
  instances: ComputeResource[]
}

export interface CreateBastionSessionRequest {
  bastionId: string
  targetResourceDetails: any
  keyDetails: any
  sessionTtlInSeconds?: number
  displayName?: string
  region?: string
}

export interface DeleteBastionSessionRequest {
  sessionId: string
  region?: string
}

export interface RunBastionSshCommandRequest {
  sessionId: string
  sessionName?: string
  bastionName?: string
  executable: string
  args: string[]
}

export interface RunBastionSshCommandResponse {
  launched: boolean
}

export type SpeechTranscriptionModelType = "WHISPER_MEDIUM" | "WHISPER_LARGE_V3T"

export type SpeechTranscriptionLanguageCode = "ja" | "en" | "zh"

export type SpeechProfanityFilterMode = "MASK"

export interface SpeechTranscriptionJobResource {
  id: string
  name: string
  compartmentId: string
  region: string
  lifecycleState: string
  lifecycleDetails?: string
  description?: string
  percentComplete?: number
  totalTasks?: number
  outstandingTasks?: number
  successfulTasks?: number
  timeAccepted?: string
  timeStarted?: string
  timeFinished?: string
  inputNamespaceName?: string
  inputBucketName?: string
  inputObjectNames?: string[]
  outputNamespaceName?: string
  outputBucketName?: string
  outputPrefix?: string
  modelType?: SpeechTranscriptionModelType | string
  languageCode?: SpeechTranscriptionLanguageCode | string
  domain?: string
  additionalTranscriptionFormats?: string[]
  isPunctuationEnabled?: boolean
  isDiarizationEnabled?: boolean
  numberOfSpeakers?: number
  profanityFilterMode?: SpeechProfanityFilterMode | string
  whisperPrompt?: string
}

export interface SpeechTranscriptionTaskResource {
  id: string
  name: string
  jobId: string
  lifecycleState: string
  lifecycleDetails?: string
  percentComplete?: number
  fileSizeInBytes?: number
  fileDurationInSeconds?: number
  processingDurationInSeconds?: number
  timeStarted?: string
  timeFinished?: string
  inputNamespaceName?: string
  inputBucketName?: string
  inputObjectNames?: string[]
  outputNamespaceName?: string
  outputBucketName?: string
  outputObjectNames?: string[]
}

export interface ListSpeechTranscriptionJobsResponse {
  jobs: SpeechTranscriptionJobResource[]
}

export interface GetSpeechTranscriptionJobRequest {
  transcriptionJobId: string
}

export interface GetSpeechTranscriptionJobResponse {
  job: SpeechTranscriptionJobResource
}

export interface CreateSpeechTranscriptionJobRequest {
  compartmentId: string
  displayName?: string
  description?: string
  inputNamespaceName: string
  inputBucketName: string
  inputObjectNames: string[]
  outputNamespaceName: string
  outputBucketName: string
  outputPrefix?: string
  modelType: SpeechTranscriptionModelType
  languageCode: SpeechTranscriptionLanguageCode
  includeSrt?: boolean
  enablePunctuation?: boolean
  enableDiarization?: boolean
  profanityFilterMode?: SpeechProfanityFilterMode
  whisperPrompt?: string
}

export interface CreateSpeechTranscriptionJobResponse {
  job: SpeechTranscriptionJobResource
}

export interface CancelSpeechTranscriptionJobRequest {
  transcriptionJobId: string
}

export interface DeleteSpeechTranscriptionJobRequest {
  transcriptionJobId: string
}

export interface ListSpeechTranscriptionTasksRequest {
  transcriptionJobId: string
}

export interface ListSpeechTranscriptionTasksResponse {
  tasks: SpeechTranscriptionTaskResource[]
}

// --- OCA Proxy Types ---

export interface OcaProxyStatus {
  isAuthenticated: boolean
  authInProgress: boolean
  authError: string | null
  proxyRunning: boolean
  proxyPort: number
  authCallbackPort: number
  localBaseUrl: string
  model: string
  reasoningEffort: string
  exposeToAssistant: boolean
  apiKey: string
  availableModels: string[]
  baseUrl: string
}

export interface OcaFetchModelsResponse {
  models: string[]
}

export interface OcaProxySaveConfigRequest {
  model: string
  reasoningEffort: string
  proxyPort: number
  exposeToAssistant: boolean
}

export interface OcaGenerateApiKeyResponse {
  apiKey: string
}

// --- MCP Types ---

export type McpTransportType = "stdio" | "sse" | "streamableHttp"

export interface McpServerConfig {
  transportType: McpTransportType
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  disabled?: boolean
  timeout?: number
  autoApprove?: string[]
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpResourceInfo {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpPromptInfo {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error"

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpServerStatus
  error?: string
  tools: McpToolInfo[]
  resources: McpResourceInfo[]
  prompts: McpPromptInfo[]
}

export interface AddMcpServerRequest {
  name: string
  config: McpServerConfig
}

export interface UpdateMcpServerRequest {
  currentName: string
  name: string
  config: McpServerConfig
}

export interface ToggleMcpToolAutoApproveRequest {
  serverName: string
  toolName: string
  approved: boolean
}

// --- Agent Types ---

export type AgentMode = "chat" | "agent"

export type AgentSkillSource = "bundled" | "workspace" | "user" | "extra"

export type AgentSkillInstallKind = "brew" | "node" | "go" | "uv" | "download"
export type AgentSkillImportScope = "workspace" | "user"
export type AgentSkillSuppressionScope = "rule" | "file" | "rule-file"

export interface AgentSkillSuppression {
  scope: AgentSkillSuppressionScope
  ruleId?: string
  file?: string
  note?: string
  createdAt?: string
}

export interface AgentSkillConfigEntry {
  enabled?: boolean
  apiKey?: string
  env?: Record<string, string>
  config?: Record<string, unknown>
}

export interface AgentSkillsConfig {
  entries?: Record<string, AgentSkillConfigEntry>
  allowBundled?: string[]
  suppressions?: AgentSkillSuppression[]
  load?: {
    extraDirs?: string[]
    watch?: boolean
    watchDebounceMs?: number
    includeBundled?: boolean
    includeWorkspace?: boolean
    includeUser?: boolean
  }
  install?: {
    preferBrew?: boolean
    nodeManager?: "npm" | "pnpm" | "yarn" | "bun"
  }
}

export interface AgentSkillConfigCheck {
  path: string
  satisfied: boolean
}

export interface AgentSkillDiagnosticIssue {
  label: string
  count: number
}

export interface AgentSkillSecurityRuleInfo {
  ruleId: string
  severity: "info" | "warn" | "critical"
  message: string
  recommendation: string
}

export interface AgentSkillSecurityRuleStat {
  ruleId: string
  count: number
}

export interface AgentSkillSecurityRuleSummary {
  ruleId: string
  severity: "info" | "warn" | "critical"
  message: string
  recommendation: string
  count: number
  suppressedCount: number
  matchingSuppressions: AgentSkillSuppression[]
}

export interface AgentSkillSuppressionSummary {
  suppression: AgentSkillSuppression
  affectedFindings: number
  affectedSkills: string[]
}

export interface AgentSkillFindingLocationRequest {
  file: string
  line: number
}

export interface AgentSkillFindingLocationResponse {
  opened: boolean
  file: string
  line: number
}

export type AgentSkillSecurityScanStatus = "pending" | "ready" | "error"

export interface AgentSkillSecurityFinding {
  ruleId: string
  severity: "info" | "warn" | "critical"
  file: string
  line: number
  message: string
  evidence: string
  recommendation: string
}

export interface AgentSkillSecuritySummary {
  status: AgentSkillSecurityScanStatus
  scannedFiles: number
  critical: number
  warn: number
  info: number
  suppressed: number
  findings: AgentSkillSecurityFinding[]
  error?: string
}

export interface AgentSkillsDiagnosticReport {
  generatedAt: string
  counts: {
    total: number
    ready: number
    missing: number
    allowlistBlocked: number
    disabled: number
    installableFixes: number
    securityFlagged: number
    securityCritical: number
    securitySuppressed: number
  }
  topIssues: AgentSkillDiagnosticIssue[]
  securityRules: AgentSkillSecurityRuleInfo[]
  securityRuleStats: AgentSkillSecurityRuleStat[]
  securityRuleSummary: AgentSkillSecurityRuleSummary[]
  suppressions: AgentSkillSuppression[]
  suppressionSummary: AgentSkillSuppressionSummary[]
  buckets: {
    ready: string[]
    missing: string[]
    allowlistBlocked: string[]
    disabled: string[]
    installableFixes: string[]
    securityFlagged: string[]
  }
}

export interface AgentSkillsOverview {
  state: AgentSkillsState
  diagnostics: AgentSkillsDiagnosticReport
}

export interface AgentSkillInfoReport {
  generatedAt: string
  skill: AgentSkillSummary
}

export interface AgentSkillsCheckReport {
  generatedAt: string
  diagnostics: AgentSkillsDiagnosticReport
  sections: {
    ready: AgentSkillSummary[]
    missing: AgentSkillSummary[]
    allowlistBlocked: AgentSkillSummary[]
    disabled: AgentSkillSummary[]
    installableFixes: AgentSkillSummary[]
    securityFlagged: AgentSkillSummary[]
  }
}

export interface AgentSkillInstallSpec {
  id?: string
  kind: AgentSkillInstallKind
  label?: string
  bins?: string[]
  os?: string[]
  formula?: string
  package?: string
  module?: string
  url?: string
  archive?: string
  extract?: boolean
  stripComponents?: number
  targetDir?: string
}

export interface AgentSkillInstallResult {
  ok: boolean
  skillId: string
  installerId?: string
  installerKind?: AgentSkillInstallKind
  message: string
  stdout: string
  stderr: string
  code: number | null
  warnings: string[]
  targetPath?: string
  executedCommand?: string[]
  blockedBySecurity?: boolean
}

export interface AgentSkillImportResult {
  ok: boolean
  source: string
  scope: AgentSkillImportScope
  message: string
  warnings: string[]
  importedSkillId?: string
  importedSkillName?: string
  targetRoot?: string
  targetDirectory?: string
  resolvedSourcePath?: string
  replacedExisting?: boolean
  blockedBySecurity?: boolean
}

export interface AgentSkillImportPickerResult {
  cancelled: boolean
  path?: string
}

export interface AgentSkillSummary {
  id: string
  skillKey: string
  name: string
  description?: string
  source: AgentSkillSource
  directory: string
  filePath: string
  homepage?: string
  instructionsPreview?: string
  configuredEnabled?: boolean
  enabled: boolean
  effectiveEnabled: boolean
  userInvocable: boolean
  modelInvocable: boolean
  slashCommandName?: string
  commandDispatch?: "tool"
  commandArgMode?: "raw"
  commandTool?: string
  primaryEnv?: string
  always: boolean
  blockedByAllowlist: boolean
  installers: AgentSkillInstallSpec[]
  preferredInstallerId?: string
  security: AgentSkillSecuritySummary
  missing: {
    os: string[]
    bins: string[]
    anyBins: string[]
    env: string[]
    config: string[]
  }
  configChecks: AgentSkillConfigCheck[]
  gatingReasons: string[]
}

export interface AgentSkillsState {
  skills: AgentSkillSummary[]
  watched: boolean
  sources: {
    bundledDir?: string
    workspaceDirs: string[]
    userDirs: string[]
    extraDirs: string[]
  }
}

export interface AgentAutoApprovalSettings {
  readFiles: boolean
  writeFiles: boolean
  executeCommands: boolean
  webSearch: boolean
  mcpTools: boolean
}

export interface AgentEnabledTools {
  readFile: boolean
  writeFile: boolean
  executeCommand: boolean
  webSearch: boolean
  browserAction: boolean
}

export interface AgentSettings {
  mode: AgentMode
  autoApproval: AgentAutoApprovalSettings
  maxAutoActions: number
  enabledTools: AgentEnabledTools
}

export interface ToolCallData {
  id: string
  toolName: string
  serverName?: string
  createdAt?: string
  updatedAt?: string
  actionKind?: "tool" | "prompt" | "resource"
  actionTarget?: string
  subagentId?: string
  subagentLabel?: string
  attemptCount?: number
  parameters: Record<string, unknown>
  status: "pending" | "approved" | "denied" | "running" | "completed" | "error"
  result?: ToolCallResult
}

export interface ToolCallResult {
  content: ToolCallContent[]
  isError?: boolean
}

export interface ToolCallContent {
  type: "text" | "image" | "resource"
  text?: string
  dataUrl?: string
  uri?: string
  mimeType?: string
}

export interface McpPromptMessageData {
  role: "user" | "assistant"
  content: ToolCallContent[]
}

export interface ToolApprovalRequest {
  callId: string
  toolName: string
  serverName?: string
  parameters: Record<string, unknown>
}

export interface ToolApprovalResponse {
  callId: string
  approved: boolean
  alwaysAllow?: boolean
}

export interface McpSmokeTestStep {
  label: string
  detail?: string
  status: "info" | "success" | "error"
}

export interface McpSmokeTestResult {
  ok: boolean
  startedAt: string
  durationMs: number
  transportType: McpTransportType
  capabilities: {
    tools: number
    resources: number
    prompts: number
  }
  toolResultSummary?: string
  resourceResultSummary?: string
  promptResultSummary?: string
  error?: string
  steps: McpSmokeTestStep[]
}

export interface McpPromptPreviewRequest {
  serverName: string
  promptName: string
  args?: Record<string, string>
}

export interface McpPromptPreviewResponse {
  serverName: string
  promptName: string
  args: Record<string, string>
  description?: string
  messages: McpPromptMessageData[]
  previewText: string
}

export interface McpResourcePreviewRequest {
  serverName: string
  uri: string
}

export interface McpResourcePreviewResponse {
  serverName: string
  uri: string
  result: ToolCallResult
  previewText: string
}
