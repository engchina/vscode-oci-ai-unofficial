import type { AppState, CodeContextPayload, ListAdbResponse, ListComputeResponse, SaveSettingsRequest, SendMessageRequest, SettingsState, StreamTokenResponse } from "./types"
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

  static switchCompartment(id: string): Promise<void> {
    return this.makeUnaryRequest<void>("switchCompartment", { id })
  }

  static saveCompartment(name: string, id: string): Promise<void> {
    return this.makeUnaryRequest<void>("saveCompartment", { name, id })
  }

  static deleteCompartment(id: string): Promise<void> {
    return this.makeUnaryRequest<void>("deleteCompartment", { id })
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

  static subscribeToCodeContextReady(callbacks: Callbacks<CodeContextPayload>): () => void {
    return this.makeStreamingRequest<CodeContextPayload>("subscribeToCodeContextReady", {}, callbacks)
  }
}

export class ResourceServiceClient extends ProtoBusClient {
  static override serviceName = "ResourceService"

  static listCompute(): Promise<ListComputeResponse> {
    return this.makeUnaryRequest<ListComputeResponse>("listCompute", {})
  }

  static startCompute(instanceId: string): Promise<void> {
    return this.makeUnaryRequest<void>("startCompute", { instanceId })
  }

  static stopCompute(instanceId: string): Promise<void> {
    return this.makeUnaryRequest<void>("stopCompute", { instanceId })
  }

  static listAdb(): Promise<ListAdbResponse> {
    return this.makeUnaryRequest<ListAdbResponse>("listAdb", {})
  }

  static startAdb(autonomousDatabaseId: string): Promise<void> {
    return this.makeUnaryRequest<void>("startAdb", { autonomousDatabaseId })
  }

  static stopAdb(autonomousDatabaseId: string): Promise<void> {
    return this.makeUnaryRequest<void>("stopAdb", { autonomousDatabaseId })
  }
}
