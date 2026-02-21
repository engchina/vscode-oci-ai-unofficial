/** Chat message role */
export interface ChatMessageData {
  role: "user" | "model";
  text: string;
}

/** Full application state pushed to webview */
export interface AppState {
  profile: string;
  region: string;
  compartmentId: string;
  genAiRegion: string;
  genAiLlmModelId: string;
  genAiEmbeddingModelId: string;
  chatMessages: ChatMessageData[];
  isStreaming: boolean;
}

/** Settings payload for saving */
export interface SaveSettingsRequest {
  profile: string;
  region: string;
  compartmentId: string;
  genAiRegion: string;
  genAiLlmModelId: string;
  genAiEmbeddingModelId: string;
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
  privateKeyPassphrase: string;
}

/** Settings state including secrets for display */
export interface SettingsState extends SaveSettingsRequest {}

/** Chat send request */
export interface SendMessageRequest {
  text: string;
}

/** Chat stream token response */
export interface StreamTokenResponse {
  token: string;
  done: boolean;
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
