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

export interface AppState {
  activeProfile: string
  profile: string
  region: string
  compartmentId: string
  computeCompartmentIds: string[]
  chatCompartmentId: string
  adbCompartmentIds: string[]
  dbSystemCompartmentIds: string[]
  vcnCompartmentIds: string[]
  profilesConfig: ProfileConfig[]
  tenancyOcid: string
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  chatMessages: ChatMessageData[]
  isStreaming: boolean
  configWarning: string
}

export interface SaveSettingsRequest {
  activeProfile: string
  profile: string
  region: string
  compartmentId: string
  computeCompartmentIds: string[]
  chatCompartmentId: string
  adbCompartmentIds: string[]
  dbSystemCompartmentIds: string[]
  vcnCompartmentIds: string[]
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

export interface SavedCompartment {
  name: string
  id: string
}

export interface SettingsState extends SaveSettingsRequest {
  /** Indicates which authentication method is currently active */
  authMode: "api-key" | "config-file"
  /** Named compartments saved for quick switching */
  savedCompartments: SavedCompartment[]
  profilesConfig: ProfileConfig[]
}

export interface ProfileSecretsResponse {
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase: string
  region: string
  authMode: "api-key" | "config-file"
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
}

export interface ExecuteAdbSqlResponse {
  isSelect: boolean
  columns: string[]
  rows: AdbSqlRow[]
  rowsAffected: number
  message: string
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
