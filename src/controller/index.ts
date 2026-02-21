import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { GenAiService, type ChatMessage } from "../oci/genAiService";
import { OciService } from "../oci/ociService";
import type { AppState, SaveSettingsRequest, SettingsState, StreamTokenResponse } from "../shared/services";
import type { ExtensionMessage } from "../shared/messages";

export type PostMessageToWebview = (message: ExtensionMessage) => Thenable<boolean | undefined>;
export type StreamingResponseHandler<T> = (response: T, isLast?: boolean) => Promise<void>;

export class Controller {
  private chatHistory: ChatMessage[] = [];
  private stateSubscribers: Map<string, StreamingResponseHandler<AppState>> = new Map();
  private settingsButtonSubscribers: Map<string, StreamingResponseHandler<unknown>> = new Map();
  private chatButtonSubscribers: Map<string, StreamingResponseHandler<unknown>> = new Map();

  constructor(
    private readonly authManager: AuthManager,
    private readonly ociService: OciService,
    private readonly genAiService: GenAiService,
  ) {}

  /** Get current app state */
  public getState(): AppState {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    return {
      profile: cfg.get<string>("profile", "DEFAULT"),
      region: cfg.get<string>("region", ""),
      compartmentId: cfg.get<string>("compartmentId", ""),
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: cfg.get<string>("genAiLlmModelId", "") || cfg.get<string>("genAiModelId", ""),
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      chatMessages: this.chatHistory.map(m => ({ role: m.role, text: m.text })),
      isStreaming: false,
    };
  }

  /** Get settings including secrets */
  public async getSettings(): Promise<SettingsState> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const secrets = await this.authManager.getApiKeySecrets();
    return {
      profile: cfg.get<string>("profile", "DEFAULT"),
      region: cfg.get<string>("region", ""),
      compartmentId: cfg.get<string>("compartmentId", ""),
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: cfg.get<string>("genAiLlmModelId", "") || cfg.get<string>("genAiModelId", ""),
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      ...secrets,
    };
  }

  /** Save settings */
  public async saveSettings(payload: SaveSettingsRequest): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    await cfg.update("profile", String(payload.profile ?? "").trim() || "DEFAULT", vscode.ConfigurationTarget.Global);
    await this.authManager.updateRegion(String(payload.region ?? ""));
    await this.authManager.updateCompartmentId(String(payload.compartmentId ?? ""));
    await cfg.update("genAiRegion", String(payload.genAiRegion ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiLlmModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiEmbeddingModelId", String(payload.genAiEmbeddingModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await this.authManager.updateApiKeySecrets({
      tenancyOcid: String(payload.tenancyOcid ?? ""),
      userOcid: String(payload.userOcid ?? ""),
      fingerprint: String(payload.fingerprint ?? ""),
      privateKey: String(payload.privateKey ?? ""),
      privateKeyPassphrase: String(payload.privateKeyPassphrase ?? ""),
    });
    vscode.window.showInformationMessage("OCI settings saved.");
    // Push updated state to subscribers
    await this.broadcastState();
  }

  /** Subscribe to state updates */
  public subscribeToState(requestId: string, stream: StreamingResponseHandler<AppState>): void {
    this.stateSubscribers.set(requestId, stream);
    // Send initial state immediately
    stream(this.getState(), false);
  }

  /** Unsubscribe from state */
  public unsubscribeState(requestId: string): void {
    this.stateSubscribers.delete(requestId);
  }

  /** Broadcast state to all subscribers */
  public async broadcastState(): Promise<void> {
    const state = this.getState();
    for (const [, stream] of this.stateSubscribers) {
      await stream(state, false);
    }
  }

  /** Subscribe to settings button events */
  public subscribeToSettingsButton(requestId: string, stream: StreamingResponseHandler<unknown>): void {
    this.settingsButtonSubscribers.set(requestId, stream);
  }

  /** Subscribe to chat button events */
  public subscribeToChatButton(requestId: string, stream: StreamingResponseHandler<unknown>): void {
    this.chatButtonSubscribers.set(requestId, stream);
  }

  /** Fire settings button event */
  public async fireSettingsButtonClicked(): Promise<void> {
    for (const [, stream] of this.settingsButtonSubscribers) {
      await stream({}, false);
    }
  }

  /** Fire chat button event */
  public async fireChatButtonClicked(): Promise<void> {
    for (const [, stream] of this.chatButtonSubscribers) {
      await stream({}, false);
    }
  }

  /** Send chat message with streaming response */
  public async sendChatMessage(
    text: string,
    responseStream: StreamingResponseHandler<StreamTokenResponse>
  ): Promise<void> {
    this.chatHistory.push({ role: "user", text: text.trim() });

    let assistantText = "";
    let requestFailed = false;
    try {
      await this.genAiService.chatStream(this.chatHistory, async (token) => {
        assistantText += token;
        await responseStream({ token, done: false }, false);
      });
    } catch (error) {
      requestFailed = true;
      const detail = error instanceof Error ? error.message : String(error);
      const errMsg = `Request failed: ${detail}`;
      await responseStream({ token: errMsg, done: false }, false);
    }

    // Signal stream end
    await responseStream({ token: "", done: true }, true);

    const normalized = assistantText.trim();
    if (!requestFailed && normalized) {
      this.chatHistory.push({ role: "model", text: normalized });
    }
  }

  /** Clear chat history */
  public clearChatHistory(): void {
    this.chatHistory = [];
  }

  /** Cancel a streaming request */
  public cancelRequest(requestId: string): boolean {
    // Remove from all subscriber maps
    const removed =
      this.stateSubscribers.delete(requestId) ||
      this.settingsButtonSubscribers.delete(requestId) ||
      this.chatButtonSubscribers.delete(requestId);
    return removed;
  }

  /** List compute instances */
  public async listComputeInstances(): Promise<{ id: string; name: string; lifecycleState: string }[]> {
    return this.ociService.listComputeInstances();
  }

  /** Start a compute instance */
  public async startComputeInstance(instanceId: string): Promise<void> {
    return this.ociService.startComputeInstance(instanceId);
  }

  /** Stop a compute instance */
  public async stopComputeInstance(instanceId: string): Promise<void> {
    return this.ociService.stopComputeInstance(instanceId);
  }

  /** List autonomous databases */
  public async listAutonomousDatabases(): Promise<{ id: string; name: string; lifecycleState: string }[]> {
    return this.ociService.listAutonomousDatabases();
  }

  /** Start an autonomous database */
  public async startAutonomousDatabase(autonomousDatabaseId: string): Promise<void> {
    return this.ociService.startAutonomousDatabase(autonomousDatabaseId);
  }

  /** Stop an autonomous database */
  public async stopAutonomousDatabase(autonomousDatabaseId: string): Promise<void> {
    return this.ociService.stopAutonomousDatabase(autonomousDatabaseId);
  }
}
