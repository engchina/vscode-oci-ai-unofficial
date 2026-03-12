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
  genAiEmbeddingModelId: string
  chatMessages: ChatMessageData[]
  isStreaming: boolean
  configWarning: string
  sqlWorkbench: SqlWorkbenchState
}

export interface SaveSettingsRequest {
  activeProfile: string
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

export interface ListSpeechTranscriptionTasksRequest {
  transcriptionJobId: string
}

export interface ListSpeechTranscriptionTasksResponse {
  tasks: SpeechTranscriptionTaskResource[]
}
