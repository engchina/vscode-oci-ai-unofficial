import type { AppState, SaveSettingsRequest, SendMessageRequest, SettingsState, StreamTokenResponse } from "./types"
import { type Callbacks, ProtoBusClient } from "./grpc-client-base"

export class StateServiceClient extends ProtoBusClient {
  static override serviceName = "StateService"

  static getState(): Promise<AppState> {
    return this.makeUnaryRequest<AppState>("getState", {})
  }

  static getSettings(): Promise<SettingsState> {
    return this.makeUnaryRequest<SettingsState>("getSettings", {})
  }

  static saveSettings(request: SaveSettingsRequest): Promise<void> {
    return this.makeUnaryRequest<void>("saveSettings", request)
  }

  static subscribeToState(callbacks: Callbacks<AppState>): () => void {
    return this.makeStreamingRequest<AppState>("subscribeToState", {}, callbacks)
  }
}

export class ChatServiceClient extends ProtoBusClient {
  static override serviceName = "ChatService"

  static sendMessage(request: SendMessageRequest, callbacks: Callbacks<StreamTokenResponse>): () => void {
    return this.makeStreamingRequest<StreamTokenResponse>("sendMessage", request, callbacks)
  }

  static clearHistory(): Promise<void> {
    return this.makeUnaryRequest<void>("clearHistory", {})
  }
}

export class UiServiceClient extends ProtoBusClient {
  static override serviceName = "UiService"

  static subscribeToSettingsButtonClicked(callbacks: Callbacks<unknown>): () => void {
    return this.makeStreamingRequest<unknown>("subscribeToSettingsButtonClicked", {}, callbacks)
  }

  static subscribeToChatButtonClicked(callbacks: Callbacks<unknown>): () => void {
    return this.makeStreamingRequest<unknown>("subscribeToChatButtonClicked", {}, callbacks)
  }
}
