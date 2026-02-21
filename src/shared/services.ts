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
  /** Non-empty when required configuration is missing */
  configWarning: string;
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
  /** Named compartments saved for quick switching */
  savedCompartments: SavedCompartment[];
}

/** Chat send request */
export interface SendMessageRequest {
  text: string;
  images?: ChatImageData[];
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
