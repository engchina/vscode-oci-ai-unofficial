/** Chat image payload */
export interface ChatImageData {
  /** Data URL, e.g. data:image/png;base64,... */
  dataUrl: string;
  /** Optional lightweight preview data URL for UI rendering. */
  previewDataUrl?: string;
  mimeType: string;
  name?: string;
}

/** Chat message role */
export interface ChatMessageData {
  role: "user" | "model";
  text: string;
  /** Optional image attachments (currently user messages). */
  images?: ChatImageData[];
}

export interface ProfileConfig {
  name: string;
  compartments: SavedCompartment[];
}

/** Full application state pushed to webview */
export interface AppState {
  activeProfile: string;
  profile: string; // legacy support
  region: string;
  compartmentId: string; // legacy support
  computeCompartmentIds: string[];
  chatCompartmentId: string;
  adbCompartmentIds: string[];
  dbSystemCompartmentIds: string[];
  vcnCompartmentIds: string[];
  profilesConfig: ProfileConfig[];
  tenancyOcid: string;
  genAiRegion: string;
  genAiLlmModelId: string;
  genAiEmbeddingModelId: string;
  chatMessages: ChatMessageData[];
  isStreaming: boolean;
  /** Non-empty when required configuration is missing */
  configWarning: string;
}

/** Settings payload for saving */
export interface SaveSettingsRequest {
  activeProfile: string;
  profile: string; // legacy support
  region: string;
  compartmentId: string; // legacy support
  computeCompartmentIds: string[];
  chatCompartmentId: string;
  adbCompartmentIds: string[];
  dbSystemCompartmentIds: string[];
  vcnCompartmentIds: string[];
  genAiRegion: string;
  genAiLlmModelId: string;
  genAiEmbeddingModelId: string;
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
  privateKeyPassphrase: string;
  systemPrompt: string;

  // Feature flags
  nativeToolCall: boolean;
  parallelToolCalling: boolean;
  strictPlanMode: boolean;
  autoCompact: boolean;
  checkpoints: boolean;

  // Runtime tuning
  shellIntegrationTimeoutSec: number;
  chatMaxTokens: number;
  chatTemperature: number;
  chatTopP: number;

  // UI behavior
  suppressNotification?: boolean;
}

/** A saved compartment entry */
export interface SavedCompartment {
  name: string;
  id: string;
}

/** Settings state including secrets for display */
export interface SettingsState extends SaveSettingsRequest {
  /** Indicates which authentication method is currently active */
  authMode: "api-key" | "config-file";
  /** Named compartments saved for quick switching (legacy) */
  savedCompartments: SavedCompartment[];
  /** Named profiles and their compartments */
  profilesConfig: ProfileConfig[];
}

/** Chat send request */
export interface SendMessageRequest {
  text: string;
  images?: ChatImageData[];
  /** Optional model override selected in chat UI. */
  modelName?: string;
}

/** Chat stream token response */
export interface StreamTokenResponse {
  token: string;
  done: boolean;
}

export interface DownloadAdbWalletRequest {
  autonomousDatabaseId: string;
  walletPassword: string;
}

export interface DownloadAdbWalletResponse {
  walletPath: string;
  serviceNames: string[];
}

export interface ConnectAdbRequest {
  autonomousDatabaseId: string;
  walletPath: string;
  walletPassword?: string;
  username: string;
  password: string;
  serviceName: string;
}

export interface ConnectAdbResponse {
  connectionId: string;
  autonomousDatabaseId: string;
  serviceName: string;
  walletPath: string;
}

export interface ConnectComputeSshRequest {
  instanceId: string;
  instanceName?: string;
  host: string;
  username: string;
  port?: number;
  privateKeyPath?: string;
  disableHostKeyChecking?: boolean;
}

export interface ConnectComputeSshResponse {
  launched: boolean;
}

export interface AdbSqlRow {
  [column: string]: string | number | boolean | null;
}

export interface ExecuteAdbSqlRequest {
  connectionId: string;
  sql: string;
}

export interface ExecuteAdbSqlResponse {
  isSelect: boolean;
  columns: string[];
  rows: AdbSqlRow[];
  rowsAffected: number;
  message: string;
}

export interface ListDbSystemsResponse {
  dbSystems: import("../types").DbSystemResource[];
}

export interface ConnectDbSystemRequest {
  dbSystemId: string;
  username: string;
  password?: string;
  serviceName: string;
}

export interface ConnectDbSystemResponse {
  connectionId: string;
  dbSystemId: string;
  serviceName: string;
}

export interface ConnectDbSystemSshRequest {
  dbSystemId: string;
  dbSystemName?: string;
  host: string;
  username: string;
  port?: number;
  privateKeyPath?: string;
  disableHostKeyChecking?: boolean;
}

export interface ConnectDbSystemSshResponse {
  launched: boolean;
}

export interface ExecuteDbSystemSqlRequest {
  connectionId: string;
  sql: string;
}

export interface SaveDbSystemConnectionRequest {
  dbSystemId: string;
  username: string;
  password?: string;
  serviceName: string;
}

export interface LoadDbSystemConnectionResponse {
  dbSystemId: string;
  username: string;
  password?: string;
  serviceName: string;
}


export interface ListVcnResponse {
  vcns: import("../types").VcnResource[];
}

export interface ListSecurityListRequest {
  vcnId: string;
  region?: string;
}

export interface ListSecurityListResponse {
  securityLists: import("../types").SecurityListResource[];
}

export interface UpdateSecurityListRequest {
  securityListId: string;
  region?: string;
  ingressSecurityRules: import("../types").SecurityRule[];
  egressSecurityRules: import("../types").SecurityRule[];
}

export interface CreateSecurityListRequest {
  vcnId: string;
  compartmentId: string;
  name: string;
  region?: string;
  ingressSecurityRules: import("../types").SecurityRule[];
  egressSecurityRules: import("../types").SecurityRule[];
}

export interface DeleteSecurityListRequest {
  securityListId: string;
  region?: string;
}

/** Non-sensitive ADB connection profile stored in VSCode config */
export interface AdbConnectionProfile {
  autonomousDatabaseId: string;
  walletPath: string;
  username: string;
  serviceName: string;
}

/** Request to save an ADB connection (includes sensitive fields) */
export interface SaveAdbConnectionRequest extends AdbConnectionProfile {
  walletPassword: string;
  password: string;
}

/** Response when loading a saved ADB connection */
export interface LoadAdbConnectionResponse extends AdbConnectionProfile {
  walletPassword: string;
  password: string;
}

/**
 * Service handler type definitions.
 *
 * StateService:
 *   - getState() → AppState
 *   - getSettings() → SettingsState
 *   - saveSettings(SaveSettingsRequest) → {}
 *   - subscribeToState() → stream AppState
 *
 * ChatService:
 *   - sendMessage(SendMessageRequest) → stream StreamTokenResponse
 *   - clearHistory() → {}
 *
 * UiService:
 *   - subscribeToSettingsButtonClicked() → stream {}
 *   - subscribeToChatButtonClicked() → stream {}
 */
