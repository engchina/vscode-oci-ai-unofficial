/** Re-export shared types for webview consumption.
 *  These mirror the extension-side types in src/shared/services.ts
 *  but are self-contained so the webview bundle doesn't import from extension code.
 */

export interface ChatMessageData {
  role: "user" | "model"
  text: string
}

export interface AppState {
  profile: string
  region: string
  compartmentId: string
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  chatMessages: ChatMessageData[]
  isStreaming: boolean
}

export interface SaveSettingsRequest {
  profile: string
  region: string
  compartmentId: string
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  tenancyOcid: string
  userOcid: string
  fingerprint: string
  privateKey: string
  privateKeyPassphrase: string
}

export interface SettingsState extends SaveSettingsRequest {}

export interface SendMessageRequest {
  text: string
}

export interface StreamTokenResponse {
  token: string
  done: boolean
}
