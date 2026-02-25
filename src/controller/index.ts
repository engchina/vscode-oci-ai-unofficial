import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { GenAiService, type ChatMessage } from "../oci/genAiService";
import { AdbSqlService } from "../oci/adbSqlService";
import { OciService } from "../oci/ociService";
import type {
  ConnectComputeSshRequest,
  ConnectComputeSshResponse,
  ConnectAdbRequest,
  ConnectAdbResponse,
  DownloadAdbWalletRequest,
  DownloadAdbWalletResponse,
  ExecuteAdbSqlRequest,
  ExecuteAdbSqlResponse,
  AppState,
  ChatImageData,
  SavedCompartment,
  SaveSettingsRequest,
  SendMessageRequest,
  SettingsState,
  StreamTokenResponse
} from "../shared/services";
import type { ExtensionMessage } from "../shared/messages";

export type PostMessageToWebview = (message: ExtensionMessage) => Thenable<boolean | undefined>;
export type StreamingResponseHandler<T> = (response: T, isLast?: boolean) => Promise<void>;

export interface CodeContextPayload {
  code: string;
  filename: string;
  language: string;
  /** When set, the webview auto-sends this prompt along with the code block */
  prompt?: string;
}

const CHAT_HISTORY_KEY = "ociAi.chatHistory";
const MAX_PERSISTED_MESSAGES = 100;
const DEFAULT_SHELL_TIMEOUT_SEC = 4;
const DEFAULT_CHAT_MAX_TOKENS = 64000;
const MAX_CHAT_MAX_TOKENS = 128000;
const DEFAULT_CHAT_TEMPERATURE = 0;
const DEFAULT_CHAT_TOP_P = 1;
const MAX_IMAGES_PER_MESSAGE = 10;

type ActiveChatRequest = {
  abortController: AbortController;
  cancelled: boolean;
};

export class Controller {
  private chatHistory: ChatMessage[] = [];
  private stateSubscribers: Map<string, StreamingResponseHandler<AppState>> = new Map();
  private settingsButtonSubscribers: Map<string, StreamingResponseHandler<unknown>> = new Map();
  private chatButtonSubscribers: Map<string, StreamingResponseHandler<unknown>> = new Map();
  private codeContextSubscribers: Map<string, StreamingResponseHandler<CodeContextPayload>> = new Map();
  private activeChatRequests: Map<string, ActiveChatRequest> = new Map();

  constructor(
    private readonly authManager: AuthManager,
    private readonly ociService: OciService,
    private readonly genAiService: GenAiService,
    private readonly adbSqlService: AdbSqlService,
    private readonly workspaceState?: vscode.Memento,
  ) {
    // Restore persisted chat history
    if (workspaceState) {
      const persisted = workspaceState.get<ChatMessage[]>(CHAT_HISTORY_KEY, []);
      this.chatHistory = Array.isArray(persisted) ? persisted : [];
    }
  }

  /** Get current app state */
  public getState(): AppState {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentId = cfg.get<string>("compartmentId", "").trim();
    const genAiLlmModelIdRaw =
      cfg.get<string>("genAiLlmModelId", "").trim() || cfg.get<string>("genAiModelId", "").trim();
    const hasModelName = splitModelNames(genAiLlmModelIdRaw).length > 0;

    const warnings: string[] = [];
    if (!compartmentId) warnings.push("Compartment ID not set (OCI Settings → Compartment ID).");
    if (!hasModelName) warnings.push("LLM Model Name not set (OCI Settings → LLM Model Name).");

    return {
      profile: cfg.get<string>("profile", "DEFAULT"),
      region: cfg.get<string>("region", ""),
      compartmentId,
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: genAiLlmModelIdRaw,
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      chatMessages: this.chatHistory.map(m => ({ role: m.role, text: m.text, images: m.images })),
      isStreaming: false,
      configWarning: warnings.join(" "),
    };
  }

  /** Get settings including secrets */
  public async getSettings(): Promise<SettingsState> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const secrets = await this.authManager.getApiKeySecrets();
    const authMode: "api-key" | "config-file" =
      secrets.tenancyOcid && secrets.userOcid && secrets.fingerprint && secrets.privateKey
        ? "api-key"
        : "config-file";
    const savedCompartments = cfg.get<SavedCompartment[]>("savedCompartments", []);
    return {
      profile: cfg.get<string>("profile", "DEFAULT"),
      region: cfg.get<string>("region", ""),
      compartmentId: cfg.get<string>("compartmentId", ""),
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: cfg.get<string>("genAiLlmModelId", "") || cfg.get<string>("genAiModelId", ""),
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      systemPrompt: cfg.get<string>("systemPrompt", ""),
      nativeToolCall: cfg.get<boolean>("nativeToolCall", true),
      parallelToolCalling: cfg.get<boolean>("parallelToolCalling", true),
      strictPlanMode: cfg.get<boolean>("strictPlanMode", true),
      autoCompact: cfg.get<boolean>("autoCompact", true),
      checkpoints: cfg.get<boolean>("checkpoints", true),
      shellIntegrationTimeoutSec: cfg.get<number>("shellIntegrationTimeoutSec", DEFAULT_SHELL_TIMEOUT_SEC),
      chatMaxTokens: cfg.get<number>("chatMaxTokens", DEFAULT_CHAT_MAX_TOKENS),
      chatTemperature: cfg.get<number>("chatTemperature", DEFAULT_CHAT_TEMPERATURE),
      chatTopP: cfg.get<number>("chatTopP", DEFAULT_CHAT_TOP_P),
      ...secrets,
      authMode,
      savedCompartments: Array.isArray(savedCompartments) ? savedCompartments : [],
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
    await cfg.update("systemPrompt", String(payload.systemPrompt ?? ""), vscode.ConfigurationTarget.Global);
    await cfg.update("nativeToolCall", Boolean(payload.nativeToolCall), vscode.ConfigurationTarget.Global);
    await cfg.update("parallelToolCalling", Boolean(payload.parallelToolCalling), vscode.ConfigurationTarget.Global);
    await cfg.update("strictPlanMode", Boolean(payload.strictPlanMode), vscode.ConfigurationTarget.Global);
    await cfg.update("autoCompact", Boolean(payload.autoCompact), vscode.ConfigurationTarget.Global);
    await cfg.update("checkpoints", Boolean(payload.checkpoints), vscode.ConfigurationTarget.Global);
    await cfg.update(
      "shellIntegrationTimeoutSec",
      coerceInt(payload.shellIntegrationTimeoutSec, DEFAULT_SHELL_TIMEOUT_SEC, 1, 120),
      vscode.ConfigurationTarget.Global
    );
    await cfg.update(
      "chatMaxTokens",
      coerceInt(payload.chatMaxTokens, DEFAULT_CHAT_MAX_TOKENS, 1, MAX_CHAT_MAX_TOKENS),
      vscode.ConfigurationTarget.Global
    );
    await cfg.update(
      "chatTemperature",
      coerceFloat(payload.chatTemperature, DEFAULT_CHAT_TEMPERATURE, 0, 2),
      vscode.ConfigurationTarget.Global
    );
    await cfg.update(
      "chatTopP",
      coerceFloat(payload.chatTopP, DEFAULT_CHAT_TOP_P, 0, 1),
      vscode.ConfigurationTarget.Global
    );
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
    payload: SendMessageRequest,
    responseStream: StreamingResponseHandler<StreamTokenResponse>,
    requestId: string
  ): Promise<void> {
    const text = String(payload.text ?? "").trim();
    const images = normalizeImages(payload.images);
    const modelName = typeof payload.modelName === "string" ? payload.modelName.trim() : undefined;

    if (!text && images.length === 0) {
      await responseStream({ token: "", done: true }, true);
      return;
    }

    this.chatHistory.push({
      role: "user",
      text,
      images: images.length > 0 ? images : undefined,
    });

    const active: ActiveChatRequest = {
      abortController: new AbortController(),
      cancelled: false,
    };
    this.activeChatRequests.set(requestId, active);

    let assistantText = "";
    let requestFailed = false;
    try {
      await this.genAiService.chatStream(
        this.chatHistory,
        async (token) => {
          assistantText += token;
          await responseStream({ token, done: false }, false);
        },
        active.abortController.signal,
        modelName
      );
    } catch (error) {
      if (active.cancelled) {
        this.persistChatHistory();
        return;
      }
      requestFailed = true;
      const detail = error instanceof Error ? error.message : String(error);
      const errMsg = `Request failed: ${detail}`;
      await responseStream({ token: errMsg, done: false }, false);
    } finally {
      this.activeChatRequests.delete(requestId);
    }

    if (active.cancelled) {
      this.persistChatHistory();
      return;
    }

    // Signal stream end
    await responseStream({ token: "", done: true }, true);

    const normalized = assistantText.trim();
    if (!requestFailed && normalized) {
      this.chatHistory.push({ role: "model", text: normalized });
    }
    this.persistChatHistory();
  }

  /** Clear chat history */
  public clearChatHistory(): void {
    this.chatHistory = [];
    this.persistChatHistory();
  }

  private persistChatHistory(): void {
    if (!this.workspaceState) return;
    // Keep persisted state lightweight by excluding large image payloads.
    const toSave = this.chatHistory.slice(-MAX_PERSISTED_MESSAGES).map((m) => ({
      role: m.role,
      text: m.text
    }));
    this.workspaceState.update(CHAT_HISTORY_KEY, toSave);
  }

  /** Subscribe to code context injection events */
  public subscribeToCodeContext(requestId: string, stream: StreamingResponseHandler<CodeContextPayload>): void {
    this.codeContextSubscribers.set(requestId, stream);
  }

  /** Fire a code context event (called when user sends code from editor) */
  public async fireCodeContext(payload: CodeContextPayload): Promise<void> {
    for (const [, stream] of this.codeContextSubscribers) {
      await stream(payload, false);
    }
  }

  /** Cancel a streaming request */
  public cancelRequest(requestId: string): boolean {
    const activeChat = this.activeChatRequests.get(requestId);
    if (activeChat) {
      activeChat.cancelled = true;
      activeChat.abortController.abort();
    }

    // Remove from all subscriber maps
    const removed =
      Boolean(activeChat) ||
      this.stateSubscribers.delete(requestId) ||
      this.settingsButtonSubscribers.delete(requestId) ||
      this.chatButtonSubscribers.delete(requestId) ||
      this.codeContextSubscribers.delete(requestId);
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

  /** Open an SSH connection to a compute instance in an integrated terminal task */
  public async connectComputeSsh(request: ConnectComputeSshRequest): Promise<ConnectComputeSshResponse> {
    const host = String(request.host ?? "").trim();
    const username = String(request.username ?? "").trim();
    if (!host) {
      throw new Error("SSH host is required.");
    }
    if (!username) {
      throw new Error("SSH username is required.");
    }

    const rawPort = request.port;
    const port = typeof rawPort === "number" ? rawPort : Number(rawPort);
    const privateKeyPath = expandHomePath(String(request.privateKeyPath ?? "").trim());
    const disableHostKeyChecking = Boolean(request.disableHostKeyChecking);

    const args: string[] = [];
    if (Number.isFinite(port) && port > 0 && port <= 65535 && port !== 22) {
      args.push("-p", String(Math.trunc(port)));
    }
    if (privateKeyPath) {
      args.push("-i", privateKeyPath);
    }
    if (disableHostKeyChecking) {
      args.push("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null");
    }
    args.push(`${username}@${host}`);

    const taskScope =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.TaskScope.Workspace
        : vscode.TaskScope.Global;

    const task = new vscode.Task(
      { type: "ociAiSsh", instanceId: request.instanceId || host, _ts: Date.now() },
      taskScope,
      `SSH ${request.instanceName?.trim() || host}`,
      "OCI AI",
      new vscode.ShellExecution("ssh", args)
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      focus: true,
      panel: vscode.TaskPanelKind.New,
      clear: false,
    };
    await vscode.tasks.executeTask(task);
    return { launched: true };
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

  /** Download wallet for an autonomous database */
  public async downloadAdbWallet(request: DownloadAdbWalletRequest): Promise<DownloadAdbWalletResponse> {
    return this.adbSqlService.downloadWallet(request);
  }

  /** Connect to autonomous database */
  public async connectAdb(request: ConnectAdbRequest): Promise<ConnectAdbResponse> {
    return this.adbSqlService.connect(request);
  }

  /** Disconnect autonomous database session */
  public async disconnectAdb(connectionId: string): Promise<void> {
    return this.adbSqlService.disconnect(connectionId);
  }

  /** Execute SQL against autonomous database */
  public async executeAdbSql(request: ExecuteAdbSqlRequest): Promise<ExecuteAdbSqlResponse> {
    return this.adbSqlService.executeSql(request);
  }

  /** Switch active compartment and broadcast updated state */
  public async switchCompartment(id: string): Promise<void> {
    await this.authManager.updateCompartmentId(id);
    await this.broadcastState();
  }

  /** Save a named compartment to the saved list */
  public async saveCompartment(name: string, id: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<SavedCompartment[]>("savedCompartments", []);
    const list = Array.isArray(existing) ? existing : [];
    const updated = list.filter(c => c.id !== id).concat({ name: name.trim(), id: id.trim() });
    await cfg.update("savedCompartments", updated, vscode.ConfigurationTarget.Global);
  }

  /** Delete a saved compartment by id */
  public async deleteCompartment(id: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<SavedCompartment[]>("savedCompartments", []);
    const list = Array.isArray(existing) ? existing : [];
    await cfg.update("savedCompartments", list.filter(c => c.id !== id), vscode.ConfigurationTarget.Global);
  }
}

function normalizeImages(images: ChatImageData[] | undefined): ChatImageData[] {
  if (!Array.isArray(images)) {
    return [];
  }
  const cleaned: ChatImageData[] = [];
  for (const img of images) {
    if (!img || typeof img.dataUrl !== "string" || typeof img.mimeType !== "string") {
      continue;
    }
    const dataUrl = img.dataUrl.trim();
    const previewDataUrl =
      typeof img.previewDataUrl === "string" ? img.previewDataUrl.trim() : undefined;
    const mimeType = img.mimeType.trim();
    if (!isImageDataUrl(dataUrl)) {
      continue;
    }
    cleaned.push({
      dataUrl,
      previewDataUrl: isImageDataUrl(previewDataUrl) ? previewDataUrl : undefined,
      mimeType,
      name: typeof img.name === "string" ? img.name.trim() : undefined,
    });
    if (cleaned.length >= MAX_IMAGES_PER_MESSAGE) {
      break;
    }
  }
  return cleaned;
}

function coerceInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(num)));
}

function coerceFloat(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, num));
}

function isImageDataUrl(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return /^data:image\//i.test(value);
}

function splitModelNames(rawValue: string): string[] {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.length > 0);
}

function expandHomePath(input: string): string {
  if (!input) {
    return "";
  }
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}
