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
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase: string
  systemPrompt: string

  nativeToolCall: boolean
  parallelToolCalling: boolean
  strictPlanMode: boolean
  autoCompact: boolean
  checkpoints: boolean

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

export interface ComputeResource {
  id: string
  name: string
  lifecycleState: string
  publicIp?: string
  privateIp?: string
}

export interface AdbResource {
  id: string
  name: string
  lifecycleState: string
}

export interface ListComputeResponse {
  instances: ComputeResource[]
}

export interface ListAdbResponse {
  databases: AdbResource[]
}

export interface CodeContextPayload {
  code: string
  filename: string
  language: string
  /** When set, the webview auto-sends this prompt along with the code block */
  prompt?: string
}
