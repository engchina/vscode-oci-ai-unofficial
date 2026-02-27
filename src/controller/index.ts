import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { AuthManager, type ApiKeySecrets } from "../auth/authManager";
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
  AdbConnectionProfile,
  SaveAdbConnectionRequest,
  LoadAdbConnectionResponse,
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
const DEFAULT_CHAT_MAX_TOKENS = 16000;
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
  public async getState(): Promise<AppState> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const profile = cfg.get<string>("profile", "DEFAULT");
    const compartmentId = cfg.get<string>("compartmentId", "").trim();
    const genAiLlmModelIdRaw =
      cfg.get<string>("genAiLlmModelId", "").trim() || cfg.get<string>("genAiModelId", "").trim();
    const hasModelName = splitModelNames(genAiLlmModelIdRaw).length > 0;
    const secrets = await this.authManager.getApiKeySecrets();

    const warnings: string[] = [];
    if (!compartmentId) warnings.push("Compartment ID not set (OCI Settings → Compartment ID).");
    if (!hasModelName) warnings.push("LLM Model Name not set (OCI Settings → LLM Model Name).");

    return {
      activeProfile: cfg.get<string>("activeProfile", "DEFAULT"),
      profile,
      region: await this.authManager.getRegionForProfile(profile),
      compartmentId,
      computeCompartmentIds: Array.isArray(cfg.get("computeCompartmentIds")) ? cfg.get<string[]>("computeCompartmentIds") as string[] : [],
      chatCompartmentId: cfg.get<string>("chatCompartmentId", ""),
      adbCompartmentIds: Array.isArray(cfg.get("adbCompartmentIds")) ? cfg.get<string[]>("adbCompartmentIds") as string[] : [],
      dbSystemCompartmentIds: Array.isArray(cfg.get("dbSystemCompartmentIds")) ? cfg.get<string[]>("dbSystemCompartmentIds") as string[] : [],
      vcnCompartmentIds: Array.isArray(cfg.get("vcnCompartmentIds")) ? cfg.get<string[]>("vcnCompartmentIds") as string[] : [],
      profilesConfig: Array.isArray(cfg.get("profilesConfig")) ? cfg.get<any[]>("profilesConfig") as any[] : [],
      tenancyOcid: secrets.tenancyOcid || "",
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
    const profile = cfg.get<string>("profile", "DEFAULT");
    const secrets = await this.authManager.getApiKeySecrets(profile);
    const authMode: "api-key" | "config-file" =
      secrets.tenancyOcid && secrets.userOcid && secrets.fingerprint && secrets.privateKey
        ? "api-key"
        : "config-file";
    const savedCompartments = cfg.get<SavedCompartment[]>("savedCompartments", []);
    const profilesConfig = cfg.get<any[]>("profilesConfig", []);
    return {
      activeProfile: cfg.get<string>("activeProfile", "DEFAULT"),
      profile,
      region: await this.authManager.getRegionForProfile(profile),
      compartmentId: cfg.get<string>("compartmentId", ""),
      computeCompartmentIds: Array.isArray(cfg.get("computeCompartmentIds")) ? cfg.get<string[]>("computeCompartmentIds") as string[] : [],
      chatCompartmentId: cfg.get<string>("chatCompartmentId", ""),
      adbCompartmentIds: Array.isArray(cfg.get("adbCompartmentIds")) ? cfg.get<string[]>("adbCompartmentIds") as string[] : [],
      dbSystemCompartmentIds: Array.isArray(cfg.get("dbSystemCompartmentIds")) ? cfg.get<string[]>("dbSystemCompartmentIds") as string[] : [],
      vcnCompartmentIds: Array.isArray(cfg.get("vcnCompartmentIds")) ? cfg.get<string[]>("vcnCompartmentIds") as string[] : [],
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: cfg.get<string>("genAiLlmModelId", "") || cfg.get<string>("genAiModelId", ""),
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      systemPrompt: cfg.get<string>("systemPrompt", ""),

      shellIntegrationTimeoutSec: cfg.get<number>("shellIntegrationTimeoutSec", DEFAULT_SHELL_TIMEOUT_SEC),
      chatMaxTokens: cfg.get<number>("chatMaxTokens", DEFAULT_CHAT_MAX_TOKENS),
      chatTemperature: cfg.get<number>("chatTemperature", DEFAULT_CHAT_TEMPERATURE),
      chatTopP: cfg.get<number>("chatTopP", DEFAULT_CHAT_TOP_P),
      ...secrets,
      authMode,
      savedCompartments: Array.isArray(savedCompartments) ? savedCompartments : [],
      profilesConfig: Array.isArray(profilesConfig) ? profilesConfig : [],
    };
  }

  /** Get API key secrets for a specific profile */
  public async getProfileSecrets(profile: string): Promise<ApiKeySecrets & { authMode: "api-key" | "config-file"; region: string }> {
    const secrets = await this.authManager.getApiKeySecrets(profile);
    const region = await this.authManager.getRegionForProfile(profile);
    const authMode: "api-key" | "config-file" =
      secrets.tenancyOcid && secrets.userOcid && secrets.fingerprint && secrets.privateKey
        ? "api-key"
        : "config-file";
    return { ...secrets, authMode, region };
  }

  /** Save settings */
  public async saveSettings(payload: SaveSettingsRequest & { profilesConfig?: any[] }): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const targetProfile = String(payload.profile ?? "").trim() || "DEFAULT";
    await cfg.update("activeProfile", String(payload.activeProfile ?? "").trim() || "DEFAULT", vscode.ConfigurationTarget.Global);
    await cfg.update("profile", targetProfile, vscode.ConfigurationTarget.Global);
    await this.authManager.updateRegionForProfile(targetProfile, String(payload.region ?? ""));
    await this.authManager.updateCompartmentId(String(payload.compartmentId ?? ""));
    await cfg.update("computeCompartmentIds", Array.isArray(payload.computeCompartmentIds) ? payload.computeCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("chatCompartmentId", String(payload.chatCompartmentId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("adbCompartmentIds", Array.isArray(payload.adbCompartmentIds) ? payload.adbCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("dbSystemCompartmentIds", Array.isArray(payload.dbSystemCompartmentIds) ? payload.dbSystemCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("vcnCompartmentIds", Array.isArray(payload.vcnCompartmentIds) ? payload.vcnCompartmentIds : [], vscode.ConfigurationTarget.Global);

    if (payload.profilesConfig) {
      await cfg.update("profilesConfig", payload.profilesConfig, vscode.ConfigurationTarget.Global);
    }

    await cfg.update("genAiRegion", String(payload.genAiRegion ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiLlmModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiEmbeddingModelId", String(payload.genAiEmbeddingModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("systemPrompt", String(payload.systemPrompt ?? ""), vscode.ConfigurationTarget.Global);

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
    }, targetProfile);
    if (!payload.suppressNotification) {
      vscode.window.showInformationMessage("OCI settings saved.");
    }
    // Push updated state to subscribers
    await this.broadcastState();
  }

  /** Update only one feature's compartment selection without overwriting unrelated settings */
  public async updateFeatureCompartmentSelection(
    featureKey: "compute" | "adb" | "dbSystem" | "vcn" | "chat",
    compartmentIds: string[]
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const normalized = Array.isArray(compartmentIds)
      ? compartmentIds.map((id) => String(id ?? "").trim()).filter((id) => id.length > 0)
      : [];

    if (featureKey === "compute") {
      await cfg.update("computeCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
    } else if (featureKey === "adb") {
      await cfg.update("adbCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
    } else if (featureKey === "dbSystem") {
      await cfg.update("dbSystemCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
    } else if (featureKey === "vcn") {
      await cfg.update("vcnCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
    } else if (featureKey === "chat") {
      await cfg.update("chatCompartmentId", normalized[0] ?? "", vscode.ConfigurationTarget.Global);
    } else {
      throw new Error(`Unsupported feature key: ${featureKey}`);
    }

    await this.broadcastState();
  }

  /** Subscribe to state updates */
  public async subscribeToState(requestId: string, stream: StreamingResponseHandler<AppState>): Promise<void> {
    this.stateSubscribers.set(requestId, stream);
    // Send initial state immediately
    stream(await this.getState(), false);
  }

  /** Unsubscribe from state */
  public unsubscribeState(requestId: string): void {
    this.stateSubscribers.delete(requestId);
  }

  /** Broadcast state to all subscribers */
  public async broadcastState(): Promise<void> {
    const state = await this.getState();
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
  public async startComputeInstance(instanceId: string, region?: string): Promise<void> {
    return this.ociService.startComputeInstance(instanceId, region);
  }

  /** Stop a compute instance */
  public async stopComputeInstance(instanceId: string, region?: string): Promise<void> {
    return this.ociService.stopComputeInstance(instanceId, region);
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
  public async startAutonomousDatabase(autonomousDatabaseId: string, region?: string): Promise<void> {
    return this.ociService.startAutonomousDatabase(autonomousDatabaseId, region);
  }

  /** Stop an autonomous database */
  public async stopAutonomousDatabase(autonomousDatabaseId: string, region?: string): Promise<void> {
    return this.ociService.stopAutonomousDatabase(autonomousDatabaseId, region);
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

  /** Save ADB connection profile (non-sensitive in config, passwords in SecretStorage) */
  public async saveAdbConnection(request: SaveAdbConnectionRequest): Promise<void> {
    const dbId = String(request.autonomousDatabaseId ?? "").trim();
    if (!dbId) {
      throw new Error("autonomousDatabaseId is required.");
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<AdbConnectionProfile[]>("adbConnectionProfiles", []);
    const profiles = Array.isArray(existing) ? existing : [];

    const profile: AdbConnectionProfile = {
      autonomousDatabaseId: dbId,
      walletPath: String(request.walletPath ?? "").trim(),
      username: String(request.username ?? "").trim(),
      serviceName: String(request.serviceName ?? "").trim(),
    };

    const updated = profiles.filter(p => p.autonomousDatabaseId !== dbId).concat(profile);
    await cfg.update("adbConnectionProfiles", updated, vscode.ConfigurationTarget.Global);

    // Store sensitive fields in SecretStorage
    const secrets = this.authManager;
    await secrets["context"].secrets.store(`ociAi.adb.${dbId}.walletPassword`, String(request.walletPassword ?? ""));
    await secrets["context"].secrets.store(`ociAi.adb.${dbId}.password`, String(request.password ?? ""));
  }

  /** Load a saved ADB connection profile */
  public async loadAdbConnection(autonomousDatabaseId: string): Promise<LoadAdbConnectionResponse | null> {
    const dbId = String(autonomousDatabaseId ?? "").trim();
    if (!dbId) {
      return null;
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<AdbConnectionProfile[]>("adbConnectionProfiles", []);
    const profiles = Array.isArray(existing) ? existing : [];
    const profile = profiles.find(p => p.autonomousDatabaseId === dbId);
    if (!profile) {
      return null;
    }

    const secretStore = this.authManager["context"].secrets;
    const walletPassword = (await secretStore.get(`ociAi.adb.${dbId}.walletPassword`)) ?? "";
    const password = (await secretStore.get(`ociAi.adb.${dbId}.password`)) ?? "";

    return {
      autonomousDatabaseId: profile.autonomousDatabaseId,
      walletPath: profile.walletPath,
      username: profile.username,
      serviceName: profile.serviceName,
      walletPassword,
      password,
    };
  }

  /** Delete a saved ADB connection profile and its secrets */
  public async deleteAdbConnection(autonomousDatabaseId: string): Promise<void> {
    const dbId = String(autonomousDatabaseId ?? "").trim();
    if (!dbId) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<AdbConnectionProfile[]>("adbConnectionProfiles", []);
    const profiles = Array.isArray(existing) ? existing : [];
    await cfg.update(
      "adbConnectionProfiles",
      profiles.filter(p => p.autonomousDatabaseId !== dbId),
      vscode.ConfigurationTarget.Global,
    );

    const secretStore = this.authManager["context"].secrets;
    await secretStore.delete(`ociAi.adb.${dbId}.walletPassword`);
    await secretStore.delete(`ociAi.adb.${dbId}.password`);
  }

  public async listVcns(): Promise<import("../types").VcnResource[]> {
    return this.ociService.listVcns();
  }

  public async listDbSystems(): Promise<import("../types").DbSystemResource[]> {
    return this.ociService.listDbSystems();
  }

  public async startDbSystem(dbSystemId: string, region?: string): Promise<void> {
    return this.ociService.startDbSystem(dbSystemId, region);
  }

  public async stopDbSystem(dbSystemId: string, region?: string): Promise<void> {
    return this.ociService.stopDbSystem(dbSystemId, region);
  }

  public async connectDbSystem(request: import("../shared/services").ConnectDbSystemRequest): Promise<import("../shared/services").ConnectDbSystemResponse> {
    return this.adbSqlService.connectDbSystem(request);
  }

  public async disconnectDbSystem(connectionId: string): Promise<void> {
    return this.adbSqlService.disconnect(connectionId);
  }

  public async getDbSystemConnectionStrings(request: import("../shared/services").GetDbSystemConnectionStringsRequest): Promise<import("../shared/services").GetDbSystemConnectionStringsResponse> {
    const connectionStrings = await this.ociService.getDbSystemConnectionStrings(
      request.dbSystemId,
      request.compartmentId,
      request.region,
      request.publicIp
    );
    return { connectionStrings };
  }

  public async executeDbSystemSql(request: import("../shared/services").ExecuteDbSystemSqlRequest): Promise<import("../shared/services").ExecuteAdbSqlResponse> {
    return this.adbSqlService.executeDbSystemSql(request);
  }

  public async getOracleDbDiagnostics(): Promise<import("../shared/services").OracleDbDiagnosticsResponse> {
    return this.adbSqlService.getOracleDbDiagnostics();
  }

  public async saveDbSystemConnection(request: import("../shared/services").SaveDbSystemConnectionRequest): Promise<void> {
    const dbId = String(request.dbSystemId ?? "").trim();
    if (!dbId) {
      throw new Error("dbSystemId is required.");
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<any[]>("dbSystemConnectionProfiles", []);
    const profiles = Array.isArray(existing) ? existing : [];

    const profile = {
      dbSystemId: dbId,
      username: String(request.username ?? "").trim(),
      serviceName: String(request.serviceName ?? "").trim(),
    };

    const updated = profiles.filter(p => p.dbSystemId !== dbId).concat(profile);
    await cfg.update("dbSystemConnectionProfiles", updated, vscode.ConfigurationTarget.Global);

    const secrets = this.authManager;
    await secrets["context"].secrets.store(`ociAi.dbSystem.${dbId}.password`, String(request.password ?? ""));
  }

  public async loadDbSystemConnection(dbSystemId: string): Promise<import("../shared/services").LoadDbSystemConnectionResponse | null> {
    const dbId = String(dbSystemId ?? "").trim();
    if (!dbId) {
      return null;
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<any[]>("dbSystemConnectionProfiles", []);
    const profiles = Array.isArray(existing) ? existing : [];
    const profile = profiles.find(p => p.dbSystemId === dbId);
    if (!profile) {
      return null;
    }

    const secretStore = this.authManager["context"].secrets;
    const password = (await secretStore.get(`ociAi.dbSystem.${dbId}.password`)) ?? "";

    return {
      dbSystemId: profile.dbSystemId,
      username: profile.username,
      serviceName: profile.serviceName,
      password,
    };
  }

  public async deleteDbSystemConnection(dbSystemId: string): Promise<void> {
    const dbId = String(dbSystemId ?? "").trim();
    if (!dbId) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<any[]>("dbSystemConnectionProfiles", []);
    const profiles = Array.isArray(existing) ? existing : [];
    await cfg.update(
      "dbSystemConnectionProfiles",
      profiles.filter(p => p.dbSystemId !== dbId),
      vscode.ConfigurationTarget.Global,
    );

    const secretStore = this.authManager["context"].secrets;
    await secretStore.delete(`ociAi.dbSystem.${dbId}.password`);
  }

  public async connectDbSystemSsh(request: import("../shared/services").ConnectDbSystemSshRequest): Promise<import("../shared/services").ConnectDbSystemSshResponse> {
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
      { type: "ociAiSshDbSystem", dbSystemId: request.dbSystemId || host, _ts: Date.now() },
      taskScope,
      `SSH DB Node: ${request.dbSystemName?.trim() || host}`,
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


  public async listSecurityLists(vcnId: string, region?: string): Promise<import("../types").SecurityListResource[]> {
    return this.ociService.listSecurityLists(vcnId, region);
  }

  public async updateSecurityList(
    securityListId: string,
    ingressSecurityRules: import("../types").SecurityRule[],
    egressSecurityRules: import("../types").SecurityRule[],
    region?: string
  ): Promise<void> {
    return this.ociService.updateSecurityList(securityListId, ingressSecurityRules, egressSecurityRules, region);
  }

  public async createSecurityList(
    compartmentId: string,
    vcnId: string,
    name: string,
    ingressSecurityRules: import("../types").SecurityRule[],
    egressSecurityRules: import("../types").SecurityRule[],
    region?: string
  ): Promise<void> {
    return this.ociService.createSecurityList(compartmentId, vcnId, name, ingressSecurityRules, egressSecurityRules, region);
  }

  public async deleteSecurityList(securityListId: string, region?: string): Promise<void> {
    return this.ociService.deleteSecurityList(securityListId, region);
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
