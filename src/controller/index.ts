import { randomUUID } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { AuthManager, type ApiKeySecrets } from "../auth/authManager";
import { GenAiService, type ChatMessage } from "../oci/genAiService";
import { AdbSqlService } from "../oci/adbSqlService";
import { OciService } from "../oci/ociService";
import { OcaProxyManager } from "../oca-proxy/ocaProxyManager";
import { McpHub, type McpAllowlistAction } from "../mcp/mcpHub";
import { AgentService } from "../agent/agentService";
import { AgentSkillService, type SkillTurnContext } from "../agent/skillService";
import { SubagentService, type SubagentRun } from "../agent/subagentService";
import { executeBuiltinTool, getBuiltinToolDefinitions, isBuiltinToolEnabled } from "../agent/builtinTools";
import { AgentBootstrapService } from "../agent/bootstrapService";
import {
  readMcpFetchAutoPaginationSettings,
  readRuntimeSettings,
  saveRuntimeSettings,
} from "../config/runtimeSettings";
import type {
  McpServerState,
  AddMcpServerRequest,
  ToggleMcpToolAutoApproveRequest,
  UpdateMcpServerRequest,
  AgentEnabledTools,
  AgentSkillImportResult,
  AgentSkillImportPickerResult,
  AgentSkillFindingLocationResponse,
  AgentSkillImportScope,
  AgentSkillInstallResult,
  AgentSkillInfoReport,
  AgentSkillSuppressionScope,
  AgentSkillsCheckReport,
  AgentSkillsDiagnosticReport,
  AgentSkillsOverview,
  AgentSettings,
  AgentSkillsState,
  McpPromptPreviewRequest,
  McpPromptPreviewResponse,
  McpResourcePreviewRequest,
  McpResourcePreviewResponse,
  ToolCallData,
  ToolCallResult,
  ToolApprovalResponse,
  McpSmokeTestResult,
  BootstrapState,
} from "../shared/mcp-types";
import type {
  ConnectComputeSshRequest,
  ConnectComputeSshResponse,
  ConnectAdbRequest,
  ConnectAdbResponse,
  CreateObjectStorageParResponse,
  DownloadObjectStorageObjectRequest,
  DownloadObjectStorageObjectResponse,
  ReadObjectStorageObjectTextRequest,
  ReadObjectStorageObjectTextResponse,
  DownloadAdbWalletRequest,
  DownloadAdbWalletResponse,
  ExplainSqlPlanRequest,
  ExplainSqlPlanResponse,
  ExecuteAdbSqlRequest,
  ExecuteAdbSqlResponse,
  AdbConnectionProfile,
  ListObjectStorageObjectsResponse,
  SaveAdbConnectionRequest,
  LoadAdbConnectionResponse,
  AppState,
  ChatImageData,
  ChatMessageData,
  DeleteSqlFavoriteRequest,
  SavedCompartment,
  SaveSettingsRequest,
  SendMessageRequest,
  SettingsState,
  SqlAssistantRequest,
  SqlAssistantResponse,
  RunBastionSshCommandRequest,
  RunBastionSshCommandResponse,
  SqlFavoriteEntry,
  SqlHistoryEntry,
  SqlWorkbenchConnectionType,
  SqlWorkbenchState,
  StreamTokenResponse,
  TestSqlConnectionResponse,
  SaveSqlFavoriteRequest,
  UploadObjectStorageObjectResponse,
  CreateSpeechTranscriptionJobRequest,
  CreateSpeechTranscriptionJobResponse,
  GetSpeechTranscriptionJobResponse,
  ListSpeechTranscriptionJobsResponse,
  ListSpeechTranscriptionTasksResponse,
  OcaProxyStatus,
  OcaFetchModelsResponse,
  OcaProxySaveConfigRequest,
  OcaGenerateApiKeyResponse,
  SubagentRunData,
  SubagentMessageRequest,
  SubagentKillRequest,
  SubagentTranscriptRequest,
  SubagentTranscriptResponse,
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
const SQL_WORKBENCH_STATE_KEY = "ociAi.sqlWorkbench";
const MAX_PERSISTED_MESSAGES = 100;
const MAX_SQL_HISTORY_ITEMS = 50;
const MAX_SQL_FAVORITES = 30;
const MAX_IMAGES_PER_MESSAGE = 10;
const MAX_SPEECH_OBJECTS_PER_JOB = 100;
const MAX_WHISPER_PROMPT_LENGTH = 4000;
const MAX_MCP_EXECUTION_ATTEMPTS = 2;
const MAX_MCP_PARSE_REPAIR_ATTEMPTS = 2;
const MCP_RETRY_BACKOFF_MS = 350;

function getMissingApiKeyFields(secrets: ApiKeySecrets): string[] {
  const missing: string[] = [];
  if (!secrets.tenancyOcid.trim()) missing.push("Tenancy OCID");
  if (!secrets.userOcid.trim()) missing.push("User OCID");
  if (!secrets.fingerprint.trim()) missing.push("Fingerprint");
  if (!secrets.privateKey.trim()) missing.push("Private Key");
  return missing;
}

type ActiveChatRequest = {
  abortController: AbortController;
  cancelled: boolean;
};

type AgentToolExecution =
  | {
      kind: "tool";
      toolCall: ToolCallData;
      serverName: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      kind: "prompt";
      toolCall: ToolCallData;
      serverName: string;
      promptName: string;
      args: Record<string, string>;
    }
  | {
      kind: "resource";
      toolCall: ToolCallData;
      serverName: string;
      uri: string;
    }
  | {
      kind: "builtin";
      toolCall: ToolCallData;
      toolName: string;
      args: Record<string, unknown>;
    };

type McpExecutionContext = {
  requester: "main" | "subagent";
  subagentRun?: SubagentRun;
};

type ParsedAssistantMcpActions = {
  displayText: string;
  actions: AgentToolExecution[];
  repairPrompt?: string;
};

export class Controller {
  private chatHistory: ChatMessageData[] = [];
  private sqlHistory: SqlHistoryEntry[] = [];
  private sqlFavorites: SqlFavoriteEntry[] = [];
  private stateSubscribers: Map<string, StreamingResponseHandler<AppState>> = new Map();
  private settingsButtonSubscribers: Map<string, StreamingResponseHandler<unknown>> = new Map();
  private chatButtonSubscribers: Map<string, StreamingResponseHandler<unknown>> = new Map();
  private codeContextSubscribers: Map<string, StreamingResponseHandler<CodeContextPayload>> = new Map();
  private activeChatRequests: Map<string, ActiveChatRequest> = new Map();
  private mcpServerSubscribers: Map<string, StreamingResponseHandler<{ servers: McpServerState[] }>> = new Map();
  private skillSubscribers: Map<string, StreamingResponseHandler<AgentSkillsState>> = new Map();
  private skillOverviewSubscribers: Map<string, StreamingResponseHandler<AgentSkillsOverview>> = new Map();
  readonly ocaProxyManager: OcaProxyManager;
  readonly mcpHub: McpHub;
  readonly agentService: AgentService;
  readonly agentSkillService: AgentSkillService;
  readonly agentBootstrapService: AgentBootstrapService;
  readonly subagentService: SubagentService;

  constructor(
    private readonly authManager: AuthManager,
    private readonly ociService: OciService,
    private readonly genAiService: GenAiService,
    private readonly adbSqlService: AdbSqlService,
    private readonly workspaceState: vscode.Memento,
    ocaProxyManager: OcaProxyManager,
    private readonly extensionPath: string,
  ) {
    this.ocaProxyManager = ocaProxyManager;
    this.mcpHub = new McpHub();
    this.agentService = new AgentService();
    this.agentSkillService = new AgentSkillService(extensionPath);
    this.agentBootstrapService = new AgentBootstrapService(extensionPath);
    this.subagentService = new SubagentService();

    // Subscribe to MCP server changes and broadcast to webview subscribers
    this.mcpHub.onDidChange(() => {
      const servers = this.mcpHub.getServers();
      for (const [, handler] of this.mcpServerSubscribers) {
        handler({ servers }).catch(() => {});
      }
    });

    this.agentSkillService.onDidChange(() => {
      const state = this.agentSkillService.getState();
      for (const [, handler] of this.skillSubscribers) {
        handler(state).catch(() => {});
      }
      const overview = this.agentSkillService.getOverview();
      for (const [, handler] of this.skillOverviewSubscribers) {
        handler(overview).catch(() => {});
      }
    });

    // When agent mode is enabled, ensure bootstrap files exist in the workspace.
    this.agentService.onDidChange(() => {
      const settings = this.agentService.getSettings();
      if (settings.mode === "agent") {
        this.agentBootstrapService.ensureWorkspaceFiles().catch(() => {});
      }
      void this.broadcastState();
    });

    if (this.agentService.getSettings().mode === "agent") {
      this.agentBootstrapService.ensureWorkspaceFiles().catch(() => {});
    }

    this.subagentService.onDidChange(() => {
      void this.broadcastState();
    });

    // Restore persisted chat history
    if (workspaceState) {
      const persisted = workspaceState.get<ChatMessageData[]>(CHAT_HISTORY_KEY, []);
      this.chatHistory = Array.isArray(persisted) ? persisted : [];
      const persistedSqlWorkbench = workspaceState.get<SqlWorkbenchState>(SQL_WORKBENCH_STATE_KEY, {
        history: [],
        favorites: [],
      });
      this.sqlHistory = Array.isArray(persistedSqlWorkbench?.history) ? persistedSqlWorkbench.history : [];
      this.sqlFavorites = Array.isArray(persistedSqlWorkbench?.favorites) ? persistedSqlWorkbench.favorites : [];
    }
  }

  /** Get current app state */
  public async getState(): Promise<AppState> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const activeProfile = String(cfg.get<string>("activeProfile", "DEFAULT") ?? "").trim() || "DEFAULT";
    const compartmentId = cfg.get<string>("compartmentId", "").trim();
    const chatCompartmentId = cfg.get<string>("chatCompartmentId", "").trim();
    const genAiLlmModelIdRaw =
      cfg.get<string>("genAiLlmModelId", "").trim() || cfg.get<string>("genAiModelId", "").trim();
    const configuredOciAssistantModels = splitModelNames(genAiLlmModelIdRaw);
    const exposedOcaAssistantModels = this.ocaProxyManager.getAssistantModels();
    const assistantModelNames = dedupeModelNames([
      ...configuredOciAssistantModels,
      ...exposedOcaAssistantModels,
    ]).join(",");
    const hasAnyAssistantModel = configuredOciAssistantModels.length > 0 || exposedOcaAssistantModels.length > 0;
    const secrets = await this.authManager.getApiKeySecrets();
    const effectiveChatCompartmentId = chatCompartmentId || secrets.tenancyOcid.trim() || compartmentId;

    const warnings: string[] = [];
    if (!effectiveChatCompartmentId && configuredOciAssistantModels.length > 0) {
      warnings.push("Chat compartment not set for OCI Generative AI models (select one in Chat, or use the OCA Proxy assistant model).");
    }
    if (!hasAnyAssistantModel) {
      warnings.push("No Assistant model is available (configure Settings → LLM Model Name, or sign in to OCA Proxy and enable Show this model in Assistant).");
    }
    const missingApiKeyFields = getMissingApiKeyFields(secrets);
    if (missingApiKeyFields.length > 0 && configuredOciAssistantModels.length > 0) {
      warnings.push(`API Key Auth incomplete for profile "${activeProfile}": ${missingApiKeyFields.join(", ")}.`);
    }

    return {
      activeProfile,
      region: await this.authManager.getRegionForProfile(activeProfile),
      compartmentId,
      computeCompartmentIds: Array.isArray(cfg.get("computeCompartmentIds")) ? cfg.get<string[]>("computeCompartmentIds") as string[] : [],
      chatCompartmentId,
      adbCompartmentIds: Array.isArray(cfg.get("adbCompartmentIds")) ? cfg.get<string[]>("adbCompartmentIds") as string[] : [],
      dbSystemCompartmentIds: Array.isArray(cfg.get("dbSystemCompartmentIds")) ? cfg.get<string[]>("dbSystemCompartmentIds") as string[] : [],
      vcnCompartmentIds: Array.isArray(cfg.get("vcnCompartmentIds")) ? cfg.get<string[]>("vcnCompartmentIds") as string[] : [],
      objectStorageCompartmentIds: Array.isArray(cfg.get("objectStorageCompartmentIds")) ? cfg.get<string[]>("objectStorageCompartmentIds") as string[] : [],
      bastionCompartmentIds: Array.isArray(cfg.get("bastionCompartmentIds")) ? cfg.get<string[]>("bastionCompartmentIds") as string[] : [],
      speechCompartmentIds: Array.isArray(cfg.get("speechCompartmentIds")) ? cfg.get<string[]>("speechCompartmentIds") as string[] : [],
      profilesConfig: Array.isArray(cfg.get("profilesConfig")) ? cfg.get<any[]>("profilesConfig") as any[] : [],
      tenancyOcid: secrets.tenancyOcid || "",
      agentMode: this.agentService.getSettings().mode,
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: genAiLlmModelIdRaw,
      assistantModelNames,
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      chatMessages: this.chatHistory.map((message) => ({
        role: message.role,
        text: message.text,
        images: message.images,
        toolCalls: message.toolCalls,
      })),
      subagents: this.buildSubagentState(),
      isStreaming: false,
      configWarning: warnings.join(" "),
      sqlWorkbench: {
        history: this.sqlHistory,
        favorites: this.sqlFavorites,
      },
    };
  }

  /** Get settings including secrets */
  public async getSettings(): Promise<SettingsState> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const runtimeSettings = readRuntimeSettings(cfg);
    const activeProfile = String(cfg.get<string>("activeProfile", "DEFAULT") ?? "").trim() || "DEFAULT";
    const secrets = await this.authManager.getApiKeySecrets(activeProfile);
    const savedCompartments = cfg.get<SavedCompartment[]>("savedCompartments", []);
    const profilesConfig = cfg.get<any[]>("profilesConfig", []);
    return {
      activeProfile,
      agentMode: this.agentService.getSettings().mode,
      region: await this.authManager.getRegionForProfile(activeProfile),
      compartmentId: cfg.get<string>("compartmentId", ""),
      computeCompartmentIds: Array.isArray(cfg.get("computeCompartmentIds")) ? cfg.get<string[]>("computeCompartmentIds") as string[] : [],
      chatCompartmentId: cfg.get<string>("chatCompartmentId", ""),
      adbCompartmentIds: Array.isArray(cfg.get("adbCompartmentIds")) ? cfg.get<string[]>("adbCompartmentIds") as string[] : [],
      dbSystemCompartmentIds: Array.isArray(cfg.get("dbSystemCompartmentIds")) ? cfg.get<string[]>("dbSystemCompartmentIds") as string[] : [],
      vcnCompartmentIds: Array.isArray(cfg.get("vcnCompartmentIds")) ? cfg.get<string[]>("vcnCompartmentIds") as string[] : [],
      objectStorageCompartmentIds: Array.isArray(cfg.get("objectStorageCompartmentIds")) ? cfg.get<string[]>("objectStorageCompartmentIds") as string[] : [],
      bastionCompartmentIds: Array.isArray(cfg.get("bastionCompartmentIds")) ? cfg.get<string[]>("bastionCompartmentIds") as string[] : [],
      speechCompartmentIds: Array.isArray(cfg.get("speechCompartmentIds")) ? cfg.get<string[]>("speechCompartmentIds") as string[] : [],
      genAiRegion: cfg.get<string>("genAiRegion", ""),
      genAiLlmModelId: cfg.get<string>("genAiLlmModelId", "") || cfg.get<string>("genAiModelId", ""),
      genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
      systemPrompt: cfg.get<string>("systemPrompt", ""),
      ...runtimeSettings,
      ...secrets,
      authMode: "api-key",
      savedCompartments: Array.isArray(savedCompartments) ? savedCompartments : [],
      profilesConfig: Array.isArray(profilesConfig) ? profilesConfig : [],
      extensionVersion: vscode.extensions.getExtension("local.oci-ai-unofficial")?.packageJSON?.version ?? "0.0.0",
      extensionDescription: vscode.extensions.getExtension("local.oci-ai-unofficial")?.packageJSON?.description ?? "",
    };
  }

  /** Get API key secrets for a specific profile */
  public async getProfileSecrets(profile: string): Promise<ApiKeySecrets & { authMode: "api-key"; region: string }> {
    const secrets = await this.authManager.getApiKeySecrets(profile);
    const region = await this.authManager.getRegionForProfile(profile);
    return { ...secrets, authMode: "api-key", region };
  }

  /** Save settings */
  public async saveSettings(payload: SaveSettingsRequest & { profilesConfig?: any[] }): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const activeProfile = String(payload.activeProfile ?? "").trim() || "DEFAULT";
    const targetProfile = String(payload.editingProfile ?? activeProfile).trim() || activeProfile;
    const nextAgentMode = payload.agentMode === "agent" ? "agent" : "chat";
    await cfg.update("agentMode", nextAgentMode, vscode.ConfigurationTarget.Global);
    await cfg.update("activeProfile", activeProfile, vscode.ConfigurationTarget.Global);
    await this.authManager.updateRegionForProfile(targetProfile, String(payload.region ?? ""));
    await this.authManager.updateCompartmentId(String(payload.compartmentId ?? ""));
    await cfg.update("computeCompartmentIds", Array.isArray(payload.computeCompartmentIds) ? payload.computeCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("chatCompartmentId", String(payload.chatCompartmentId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("adbCompartmentIds", Array.isArray(payload.adbCompartmentIds) ? payload.adbCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("dbSystemCompartmentIds", Array.isArray(payload.dbSystemCompartmentIds) ? payload.dbSystemCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("vcnCompartmentIds", Array.isArray(payload.vcnCompartmentIds) ? payload.vcnCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("objectStorageCompartmentIds", Array.isArray(payload.objectStorageCompartmentIds) ? payload.objectStorageCompartmentIds : [], vscode.ConfigurationTarget.Global);
    await cfg.update("bastionCompartmentIds", Array.isArray(payload.bastionCompartmentIds) ? payload.bastionCompartmentIds : [], vscode.ConfigurationTarget.Global);
    if (Array.isArray(payload.speechCompartmentIds)) {
      await cfg.update("speechCompartmentIds", payload.speechCompartmentIds, vscode.ConfigurationTarget.Global);
    }

    if (payload.profilesConfig) {
      await cfg.update("profilesConfig", payload.profilesConfig, vscode.ConfigurationTarget.Global);
    }

    await cfg.update("genAiRegion", String(payload.genAiRegion ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiLlmModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiEmbeddingModelId", String(payload.genAiEmbeddingModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("genAiModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("systemPrompt", String(payload.systemPrompt ?? ""), vscode.ConfigurationTarget.Global);
    await saveRuntimeSettings(cfg, payload);
    await this.authManager.updateApiKeySecrets({
      tenancyOcid: String(payload.tenancyOcid ?? ""),
      userOcid: String(payload.userOcid ?? ""),
      fingerprint: String(payload.fingerprint ?? ""),
      privateKey: String(payload.privateKey ?? ""),
      privateKeyPassphrase: String(payload.privateKeyPassphrase ?? ""),
    }, targetProfile);
    if (!payload.suppressNotification) {
      vscode.window.showInformationMessage("Settings saved.");
    }
    // Push updated state to subscribers
    await this.broadcastState();
  }

  public async deleteProfile(profileName: string): Promise<void> {
    const trimmedProfile = String(profileName ?? "").trim();
    if (!trimmedProfile) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existingProfiles = cfg.get<{ name: string; compartments: { id: string; name: string }[] }[]>("profilesConfig", []);
    const profiles = Array.isArray(existingProfiles) ? existingProfiles : [];
    const updatedProfiles = profiles.filter((profile) => profile?.name !== trimmedProfile);
    const fallbackProfile = updatedProfiles[0]?.name?.trim() || "DEFAULT";

    const currentActiveProfile = String(cfg.get<string>("activeProfile", "DEFAULT") ?? "").trim() || "DEFAULT";
    const nextActiveProfile = currentActiveProfile === trimmedProfile ? fallbackProfile : currentActiveProfile;

    await cfg.update("profilesConfig", updatedProfiles, vscode.ConfigurationTarget.Global);

    if (currentActiveProfile === trimmedProfile) {
      const nextRegion = nextActiveProfile === trimmedProfile
        ? ""
        : await this.authManager.getRegionForProfile(nextActiveProfile);
      await cfg.update("region", nextRegion, vscode.ConfigurationTarget.Global);
    }

    if (nextActiveProfile !== currentActiveProfile) {
      await cfg.update("activeProfile", nextActiveProfile, vscode.ConfigurationTarget.Global);
    }

    await this.authManager.deleteProfileData(trimmedProfile);
    await this.broadcastState();
  }

  /** Update only one feature's compartment selection without overwriting unrelated settings */
  public async updateFeatureCompartmentSelection(
    featureKey: "compute" | "adb" | "dbSystem" | "vcn" | "chat" | "objectStorage" | "bastion" | "speech",
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
    } else if (featureKey === "objectStorage") {
      await cfg.update("objectStorageCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
    } else if (featureKey === "bastion") {
      await cfg.update("bastionCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
    } else if (featureKey === "speech") {
      await cfg.update("speechCompartmentIds", normalized, vscode.ConfigurationTarget.Global);
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

  private async streamAssistantModelResponse(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options: {
      signal?: AbortSignal;
      modelName?: string;
      runtimeSystemPrompt?: string;
    } = {},
  ): Promise<void> {
    const unavailableOcaReason = this.ocaProxyManager.getUnavailableAssistantModelReason(options.modelName);
    if (unavailableOcaReason) {
      throw new Error(unavailableOcaReason);
    }

    if (this.ocaProxyManager.handlesAssistantModel(options.modelName)) {
      await this.ocaProxyManager.chatStream(messages, onToken, {
        signal: options.signal,
        modelNameOverride: options.modelName,
        runtimeSystemPrompt: options.runtimeSystemPrompt,
      });
      return;
    }

    await this.genAiService.chatStream(messages, onToken, {
      signal: options.signal,
      modelNameOverride: options.modelName,
      runtimeSystemPrompt: options.runtimeSystemPrompt,
    });
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

  private async resolveTurnContext(rawText: string): Promise<SkillTurnContext> {
    const skillContext = this.agentSkillService.prepareTurn(rawText);
    const text = rawText.trim();
    if (!text.startsWith("/")) {
      return skillContext;
    }

    const commandMatch = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/i);
    if (!commandMatch) {
      return skillContext;
    }

    const commandName = normalizeSlashCommand(commandMatch[1]);
    const rawArgs = (commandMatch[2] ?? "").trim();

    switch (commandName) {
      case "help":
      case "commands":
        return {
          kind: "local-response",
          responseText: this.renderCommandsHelp(),
        };
      case "allowlist":
        return await this.resolveAllowlistSlashCommand(rawArgs);
      case "approve":
        return await this.resolveApproveSlashCommand(rawArgs);
      case "status":
        return {
          kind: "local-response",
          responseText: this.renderStatusReport(),
        };
      case "context":
        return {
          kind: "local-response",
          responseText: this.renderContextReport(rawArgs),
        };
      case "export-session":
      case "export":
        return {
          kind: "local-response",
          responseText: await this.exportCurrentSession(rawArgs),
        };
      case "mcp-prompt":
      case "prompt":
        return await this.resolveMcpPromptSlashCommand(rawArgs);
      case "subagents":
        return await this.resolveSubagentsSlashCommand(rawArgs);
      case "kill":
        return await this.resolveSubagentsSlashCommand(`kill ${rawArgs}`);
      case "steer":
        return await this.resolveSubagentsSlashCommand(`steer ${rawArgs}`);
      case "tell":
      case "send":
        return await this.resolveSubagentsSlashCommand(`send ${rawArgs}`);
      default:
        return skillContext;
    }
  }

  /** Send chat message with streaming response */
  public async sendChatMessage(
    payload: SendMessageRequest,
    responseStream: StreamingResponseHandler<StreamTokenResponse>,
    requestId: string
  ): Promise<void> {
    const rawText = String(payload.text ?? "").trim();
    const images = normalizeImages(payload.images);
    const modelName = typeof payload.modelName === "string" ? payload.modelName.trim() : undefined;

    if (!rawText && images.length === 0) {
      await responseStream({ token: "", done: true }, true);
      return;
    }

    const turnContext = await this.resolveTurnContext(rawText);
    const text = turnContext.kind === "model" ? turnContext.userText : rawText;

    this.chatHistory.push({
      role: "user",
      text,
      images: images.length > 0 ? images : undefined,
    });

    if (turnContext.kind === "local-response") {
      const responseText = turnContext.responseText.trim();
      await responseStream({ token: responseText, done: false }, false);
      await responseStream({ token: "", done: true }, true);
      if (responseText) {
        this.chatHistory.push({ role: "model", text: responseText });
      }
      this.persistChatHistory();
      return;
    }

    if (turnContext.kind === "tool-dispatch") {
      try {
        await this.persistAndBroadcastChatHistory();
        await this.agentSkillService.withSkillRuntimeEnvOverrides(
          () => this.executeSkillToolDispatchTurn(turnContext),
          { skillIds: [turnContext.selectedSkillId] },
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const errorMessage = `Skill dispatch failed: ${detail}`;
        this.chatHistory.push({ role: "model", text: errorMessage });
        await this.persistAndBroadcastChatHistory();
        await responseStream({ token: errorMessage, done: false }, false);
      }
      await responseStream({ token: "", done: true }, true);
      return;
    }

    const active: ActiveChatRequest = {
      abortController: new AbortController(),
      cancelled: false,
    };
    this.activeChatRequests.set(requestId, active);

    const runtimeSystemPrompt = [turnContext.runtimeSystemPrompt, this.buildMcpAgentPrompt()]
      .filter((section) => section && section.trim().length > 0)
      .join("\n\n");

    if (this.shouldUseAgentMcpLoop()) {
      try {
        await this.persistAndBroadcastChatHistory();
        await this.agentSkillService.withSkillRuntimeEnvOverrides(
          () =>
            this.runAgentMcpLoop({
              active,
              modelName,
              runtimeSystemPrompt,
            }),
          turnContext.selectedSkillId ? { skillIds: [turnContext.selectedSkillId] } : undefined,
        );
      } catch (error) {
        if (!active.cancelled) {
          const detail = error instanceof Error ? error.message : String(error);
          const errorMessage = `Agent request failed: ${detail}`;
          this.chatHistory.push({ role: "model", text: errorMessage });
          await this.persistAndBroadcastChatHistory();
          await responseStream({ token: errorMessage, done: false }, false);
        }
      } finally {
        this.activeChatRequests.delete(requestId);
      }

      await responseStream({ token: "", done: true }, true);
      return;
    }

    let assistantText = "";
    let requestFailed = false;
    try {
      await this.agentSkillService.withSkillRuntimeEnvOverrides(
        () =>
          this.streamAssistantModelResponse(
            this.buildModelMessagesFromChatHistory(),
            async (token) => {
              assistantText += token;
              await responseStream({ token, done: false }, false);
            },
            {
              signal: active.abortController.signal,
              modelName,
              runtimeSystemPrompt,
            }
          ),
        turnContext.selectedSkillId ? { skillIds: [turnContext.selectedSkillId] } : undefined,
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

  private async executeSkillToolDispatchTurn(turnContext: Extract<SkillTurnContext, { kind: "tool-dispatch" }>): Promise<void> {
    const resolvedTool = this.resolveConnectedMcpTool(turnContext.toolName);
    if (!resolvedTool) {
      throw new Error(
        `No connected MCP tool matched "${turnContext.toolName}". Check MCP Servers or use /status to inspect live capabilities.`,
      );
    }

    const args = this.buildDispatchedToolArgs(turnContext);
    const createdAt = new Date().toISOString();
    const toolCall: ToolCallData = {
      id: randomUUID(),
      toolName: resolvedTool.tool.name,
      serverName: resolvedTool.serverName,
      createdAt,
      updatedAt: createdAt,
      actionKind: "tool",
      actionTarget: resolvedTool.tool.name,
      parameters: args,
      status: "pending",
    };

    this.chatHistory.push({
      role: "model",
      text: `Running /${turnContext.slashCommandName} via ${resolvedTool.serverName}/${resolvedTool.tool.name}.`,
      toolCalls: [toolCall],
    });
    await this.persistAndBroadcastChatHistory();

    await this.executeAgentMcpAction(
      {
        kind: "tool",
        toolCall,
        serverName: resolvedTool.serverName,
        toolName: resolvedTool.tool.name,
        args,
      },
      undefined,
      { requester: "main" },
    );
  }

  private async resolveMcpPromptSlashCommand(rawArgs: string): Promise<SkillTurnContext> {
    const parts = rawArgs.match(/^([^\s]+)\s+([^\s]+)(?:\s+([\s\S]*))?$/i);
    if (!parts) {
      return {
        kind: "local-response",
        responseText:
          "Usage: `/mcp-prompt <server> <prompt> [name=value ...]`\n\n" +
          "Example: `/mcp-prompt filesystem summarize path=/workspace/src`",
      };
    }

    const serverName = parts[1];
    const promptName = parts[2];
    const promptArgs = parseKeyValueArgs(parts[3] ?? "");

    try {
      const promptResult = await this.mcpHub.getPrompt(serverName, promptName, promptArgs);
      return {
        kind: "local-response",
        responseText: this.renderMcpPromptPreview(serverName, promptName, promptArgs, promptResult),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        kind: "local-response",
        responseText: `MCP prompt failed: ${detail}`,
      };
    }
  }

  private async resolveAllowlistSlashCommand(rawArgs: string): Promise<SkillTurnContext> {
    const trimmed = rawArgs.trim();
    if (!trimmed || /^list$/i.test(trimmed)) {
      return {
        kind: "local-response",
        responseText: this.renderAllowlistReport(),
      };
    }

    const match = trimmed.match(/^(add|remove)\s+([^\s]+)(?:\s+([^\s]+))?(?:\s+scope=([^\s]+))?$/i);
    if (!match) {
      return {
        kind: "local-response",
        responseText:
          "Usage: `/allowlist`\n" +
          "`/allowlist add <server> <tool:...|prompt:...|resource:...> [scope=main|subagents|subagent:<id>|all]`\n" +
          "`/allowlist remove <server> <rule> [scope=...]`",
      };
    }

    const action = normalizeSlashCommand(match[1]) as "add" | "remove";
    const serverOrCombined = match[2];
    const maybeRule = match[3];
    const scope = normalizeAllowlistScope(match[4] ?? "all");

    let serverName = "";
    let rule = "";
    if (maybeRule) {
      serverName = serverOrCombined;
      rule = maybeRule;
    } else {
      const parsed = parseServerToolReference(serverOrCombined);
      if (!parsed) {
        return {
          kind: "local-response",
          responseText:
            `Could not parse "${serverOrCombined}". Use <server>/<tool> or <server> <rule>.`,
        };
      }
      serverName = parsed.serverName;
      rule = parsed.toolName;
    }

    if (!scope) {
      return {
        kind: "local-response",
        responseText: `Unsupported scope "${match[4]}".`,
      };
    }

    const server = this.mcpHub.getServer(serverName);
    if (!server) {
      return {
        kind: "local-response",
        responseText: `MCP server "${serverName}" is not configured.`,
      };
    }

    const canonicalEntry = canonicalizeAllowlistEntry(rule, scope);
    if (!canonicalEntry) {
      return {
        kind: "local-response",
        responseText: `Could not parse allowlist rule "${rule}".`,
      };
    }

    await this.mcpHub.toggleAllowlistEntry(serverName, canonicalEntry, action === "add");
    return {
      kind: "local-response",
      responseText:
        action === "add"
          ? `Added \`${serverName} ${formatAllowlistEntry(canonicalEntry)}\` to the MCP allowlist.`
          : `Removed \`${serverName} ${formatAllowlistEntry(canonicalEntry)}\` from the MCP allowlist.`,
    };
  }

  private async resolveApproveSlashCommand(rawArgs: string): Promise<SkillTurnContext> {
    const pending = this.getPendingApprovalCalls();
    const trimmed = rawArgs.trim();
    if (!trimmed || /^list$/i.test(trimmed)) {
      return {
        kind: "local-response",
        responseText: this.renderPendingApprovalsReport(pending),
      };
    }

    const match = trimmed.match(/^([^\s]+)\s+(allow-once|allow-always|deny)$/i);
    if (!match) {
      return {
        kind: "local-response",
        responseText:
          `${this.renderPendingApprovalsReport(pending)}\n\n` +
          "Usage: `/approve <id|#index> allow-once|allow-always|deny`",
      };
    }

    const resolution = this.resolvePendingApprovalToken(match[1], pending);
    if (!resolution.toolCall) {
      return {
        kind: "local-response",
        responseText: resolution.error ?? "Pending approval not found.",
      };
    }

    const action = normalizeSlashCommand(match[2]);
    this.agentService.resolveApproval({
      callId: resolution.toolCall.id,
      approved: action !== "deny",
      alwaysAllow: action === "allow-always",
    });

    const label = formatToolCallLabel(resolution.toolCall);
    return {
      kind: "local-response",
      responseText:
        action === "deny"
          ? `Denied pending approval for \`${label}\`.`
          : action === "allow-always"
            ? `Approved \`${label}\` and added a scoped MCP allowlist rule when supported.`
            : `Approved pending approval for \`${label}\`.`,
    };
  }

  private async resolveSubagentsSlashCommand(rawArgs: string): Promise<SkillTurnContext> {
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return {
        kind: "local-response",
        responseText: this.renderSubagentList(),
      };
    }

    const commandMatch = trimmed.match(/^([^\s]+)(?:\s+([\s\S]*))?$/i);
    if (!commandMatch) {
      return {
        kind: "local-response",
        responseText: this.renderSubagentList(),
      };
    }

    const subcommand = normalizeSlashCommand(commandMatch[1]);
    const rest = (commandMatch[2] ?? "").trim();

    switch (subcommand) {
      case "list":
        return {
          kind: "local-response",
          responseText: this.renderSubagentList(),
        };
      case "spawn":
        return await this.spawnSubagentFromSlash(rest);
      case "info":
        return {
          kind: "local-response",
          responseText: this.renderSubagentInfo(rest),
        };
      case "log":
      case "logs":
        return {
          kind: "local-response",
          responseText: this.renderSubagentLog(rest),
        };
      case "kill":
        return await this.killSubagentFromSlash(rest);
      case "send":
        return await this.sendSubagentMessageFromSlash(rest, "send");
      case "steer":
        return await this.sendSubagentMessageFromSlash(rest, "steer");
      default:
        return {
          kind: "local-response",
          responseText:
            "Usage: `/subagents list|spawn|info|log|kill|send|steer ...`\n\n" +
            "Example: `/subagents spawn researcher Inspect the latest MCP flow --model my-model`",
        };
    }
  }

  private async spawnSubagentFromSlash(rawArgs: string): Promise<SkillTurnContext> {
    const modelMatch = rawArgs.match(/(?:^|\s)--model\s+("[^"]+"|'[^']+'|\S+)\s*$/i);
    const modelName = modelMatch ? unwrapQuotedArg(modelMatch[1]) : undefined;
    const withoutModel = modelMatch ? rawArgs.slice(0, modelMatch.index).trim() : rawArgs.trim();
    const match = withoutModel.match(/^([^\s]+)\s+([\s\S]+)$/);
    if (!match) {
      return {
        kind: "local-response",
        responseText:
          "Usage: `/subagents spawn <agentId> <task> [--model <model>]`\n\n" +
          "Example: `/subagents spawn researcher Review the current MCP approval loop --model my-model`",
      };
    }

    const agentId = match[1];
    const task = match[2].trim();
    const run = this.subagentService.createRun({
      id: randomUUID(),
      agentId,
      task,
      modelName,
      parentContextSummary: this.buildSubagentParentContextSummary(),
    });
    this.driveSubagentRun(run.id);

    return {
      kind: "local-response",
      responseText:
        `Spawned subagent #${run.shortId} for "${run.agentId}".\n\n` +
        `Task: ${task}\n` +
        `Transcript: ${run.transcriptPath}`,
    };
  }

  private renderSubagentList(): string {
    const runs = this.subagentService.listRuns();
    if (runs.length === 0) {
      return [
        "No subagents have been spawned yet.",
        "",
        "Try: `/subagents spawn researcher Summarize the active MCP architecture`",
      ].join("\n");
    }

    const lines = [`Subagents: ${runs.length}`, ""];
    runs.forEach((run, index) => {
      const pendingApprovals = this.countPendingApprovalsForSubagent(run);
      const statusLabel = pendingApprovals > 0
        ? `${run.status}, approvals:${pendingApprovals}`
        : run.status;
      lines.push(
        `- #${index + 1} ${run.shortId} [${statusLabel}] ${run.agentId}: ${truncateText(run.task, 96)}`,
      );
    });
    lines.push("");
    lines.push("Use `/subagents info <id|#>` or `/subagents log <id|#>` for more detail.");
    return lines.join("\n");
  }

  private renderSubagentInfo(rawArgs: string): string {
    const resolved = this.subagentService.resolveRunToken(rawArgs);
    if (!resolved.run) {
      return resolved.error ?? "Subagent not found.";
    }

    const run = resolved.run;
    return [
      `Subagent ${run.shortId}`,
      "",
      `Status: ${run.status}`,
      `Agent: ${run.agentId}`,
      `Model: ${run.modelName ?? "(default)"}`,
      `Created: ${run.createdAt}`,
      `Updated: ${run.updatedAt}`,
      `Runtime: ${typeof run.runtimeMs === "number" ? `${run.runtimeMs} ms` : "-"}`,
      `Messages: ${run.messages.length}`,
      `Steering notes: ${run.steeringNotes.length}`,
      `Pending approvals: ${this.countPendingApprovalsForSubagent(run)}`,
      `Logs: ${run.logs.length}`,
      `Transcript: ${run.transcriptPath}`,
      "",
      `Task: ${run.task}`,
      run.resultText ? `\nLast result:\n${truncateText(run.resultText, 1200)}` : "",
      run.errorText ? `\nLast error:\n${run.errorText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private renderSubagentLog(rawArgs: string): string {
    const match = rawArgs.match(/^([^\s]+)(?:\s+(\d+))?(?:\s+([\s\S]+))?$/);
    if (!match) {
      return "Usage: `/subagents log <id|#> [limit]`";
    }

    const resolved = this.subagentService.resolveRunToken(match[1]);
    if (!resolved.run) {
      return resolved.error ?? "Subagent not found.";
    }

    const run = resolved.run;
    const limit = Math.max(1, Math.min(100, Number(match[2] ?? "20")));
    const entries = run.logs.slice(-limit);

    return [
      `Subagent log ${run.shortId} (${entries.length}/${run.logs.length})`,
      "",
      ...entries.map((entry) => `- [${entry.timestamp}] ${entry.kind}: ${entry.message}`),
      "",
      `Transcript: ${run.transcriptPath}`,
    ].join("\n");
  }

  private async killSubagentFromSlash(rawArgs: string): Promise<SkillTurnContext> {
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return {
        kind: "local-response",
        responseText: "Usage: `/subagents kill <id|#|all>`",
      };
    }

    if (normalizeSlashCommand(trimmed) === "all") {
      const runs = this.subagentService.listRuns().filter((run) => run.status === "running" || run.status === "queued");
      runs.forEach((run) => {
        this.subagentService.cancelRun(run, "Cancelled with /subagents kill all.");
      });
      return {
        kind: "local-response",
        responseText: runs.length > 0 ? `Cancelled ${runs.length} subagent run(s).` : "No running subagents to cancel.",
      };
    }

    const resolved = this.subagentService.resolveRunToken(trimmed);
    if (!resolved.run) {
      return {
        kind: "local-response",
        responseText: resolved.error ?? "Subagent not found.",
      };
    }

    this.subagentService.cancelRun(resolved.run, "Cancelled with /subagents kill.");
    return {
      kind: "local-response",
      responseText: `Cancelled subagent ${resolved.run.shortId}.`,
    };
  }

  private async sendSubagentMessageFromSlash(
    rawArgs: string,
    mode: "send" | "steer",
  ): Promise<SkillTurnContext> {
    const match = rawArgs.match(/^([^\s]+)\s+([\s\S]+)$/);
    if (!match) {
      return {
        kind: "local-response",
        responseText:
          mode === "send"
            ? "Usage: `/subagents send <id|#> <message>`"
            : "Usage: `/subagents steer <id|#> <message>`",
      };
    }

    const resolved = this.subagentService.resolveRunToken(match[1]);
    if (!resolved.run) {
      return {
        kind: "local-response",
        responseText: resolved.error ?? "Subagent not found.",
      };
    }

    if (mode === "send") {
      this.subagentService.queueUserMessage(resolved.run, match[2]);
    } else {
      this.subagentService.queueSteering(resolved.run, match[2]);
    }
    this.driveSubagentRun(resolved.run.id);

    return {
      kind: "local-response",
      responseText:
        mode === "send"
          ? `Queued a follow-up message for subagent ${resolved.run.shortId}.`
          : `Queued steering guidance for subagent ${resolved.run.shortId}.`,
    };
  }

  private driveSubagentRun(runId: string): void {
    const resolved = this.subagentService.resolveRunToken(runId);
    if (!resolved.run) {
      return;
    }
    const initialRun = resolved.run;
    if (initialRun.processing || initialRun.status === "cancelled") {
      return;
    }

    void (async () => {
      restartable: while (true) {
        const latest = this.subagentService.resolveRunToken(runId).run;
        if (!latest || latest.status === "cancelled") {
          return;
        }
        if (latest.processing) {
          return;
        }

        const observedGeneration = latest.generation;
        const abortController = this.subagentService.beginRun(latest);
        const startedAt = Date.now();
        const maxActions = Math.max(1, this.agentService.getSettings().maxAutoActions || 10);
        const workingMessages: ChatMessage[] = latest.messages.map((message) => ({
          role: message.role,
          text: message.text,
          images: message.images,
        }));
        let actionCount = 0;
        let parseRepairCount = 0;
        let finalAssistantText = "";

        try {
          while (true) {
            let assistantText = "";
            await this.streamAssistantModelResponse(
              workingMessages,
              (token) => {
                assistantText += token;
              },
              {
                signal: abortController.signal,
                modelName: latest.modelName,
                runtimeSystemPrompt: this.buildSubagentRuntimePrompt(latest),
              },
            );

            const parsed = parseAssistantMcpActions(assistantText);
            if (parsed.repairPrompt && parsed.actions.length === 0) {
              if (
                await this.queueMcpParserRepair({
                  workingMessages,
                  parsed,
                  parseRepairCount,
                  subagentRun: latest,
                })
              ) {
                parseRepairCount += 1;
                continue;
              }
            }

            if (parsed.actions.length === 0) {
              finalAssistantText =
                parsed.displayText ||
                (parsed.repairPrompt
                  ? "The subagent hit an MCP formatting issue before any tool call could be executed."
                  : assistantText.trim());
              break;
            }
            parseRepairCount = 0;

            const narration = parsed.displayText || `Subagent ${latest.shortId} is using MCP for the next step.`;
            for (const action of parsed.actions) {
              action.toolCall.subagentId = latest.id;
              action.toolCall.subagentLabel = latest.agentId;
            }

            this.subagentService.appendLog(
              latest,
              "tool",
              `Requested ${parsed.actions.length} MCP action(s).`,
            );

            const agentMessage: ChatMessageData = {
              role: "model",
              text: [
                `Subagent ${latest.shortId} (${latest.agentId}) is using MCP for the next step.`,
                parsed.displayText ? `\n${parsed.displayText}` : "",
              ]
                .join("\n")
                .trim(),
              toolCalls: parsed.actions.map((action) => action.toolCall),
            };
            this.chatHistory.push(agentMessage);
            await this.persistAndBroadcastChatHistory();

            const requestSummary = formatMcpRequestForModel(narration, parsed.actions);
            workingMessages.push({
              role: "model",
              text: requestSummary,
            });
            latest.messages.push({
              role: "model",
              text: requestSummary,
            });

            const toolResultMessages: string[] = [];
            for (const action of parsed.actions) {
              actionCount += 1;
              const result = await this.executeAgentMcpAction(action, abortController.signal, {
                requester: "subagent",
                subagentRun: latest,
              });
              toolResultMessages.push(formatMcpResultForModel(action, result));

              const interruption = this.resolveSubagentInterruption(runId, observedGeneration, abortController);
              if (interruption === "continue") {
                continue restartable;
              }
              if (interruption === "return") {
                return;
              }

              if (actionCount >= maxActions) {
                finalAssistantText =
                  "Stopped after reaching the configured MCP action limit. Review the MCP results above and continue if another step is needed.";
                break;
              }
            }

            if (finalAssistantText) {
              break;
            }

            const continuationText = `${toolResultMessages.join("\n\n")}\n\nContinue helping the parent session.`;
            workingMessages.push({
              role: "user",
              text: continuationText,
            });
            latest.messages.push({
              role: "user",
              text: continuationText,
            });
            this.subagentService.appendLog(
              latest,
              "tool",
              `Consumed ${toolResultMessages.length} MCP result(s) and continued reasoning.`,
            );

            const interruption = this.resolveSubagentInterruption(runId, observedGeneration, abortController);
            if (interruption === "continue") {
              continue restartable;
            }
            if (interruption === "return") {
              return;
            }
          }

          const interruption = this.resolveSubagentInterruption(runId, observedGeneration, abortController);
          if (interruption === "continue") {
            continue;
          }
          if (interruption === "return") {
            return;
          }

          const runtimeMs = Date.now() - startedAt;
          this.subagentService.markCompleted(latest, finalAssistantText, runtimeMs);

          if (
            latest.resultText &&
            latest.resultText.trim() !== "ANNOUNCE_SKIP" &&
            latest.announcedGeneration !== latest.completedGeneration
          ) {
            this.chatHistory.push({
              role: "model",
              text: this.renderSubagentCompletion(latest),
            });
            await this.persistAndBroadcastChatHistory();
            this.subagentService.markAnnounced(latest);
          }

          if (latest.generation !== observedGeneration) {
            continue;
          }
          return;
        } catch (error) {
          const runtimeMs = Date.now() - startedAt;
          const latestRun = this.subagentService.resolveRunToken(runId).run;
          if (!latestRun) {
            return;
          }

          const aborted = isAbortErrorLike(error);
          const shouldRestart = latestRun.generation !== observedGeneration && latestRun.status !== "cancelled";
          if (aborted && shouldRestart) {
            this.subagentService.clearActiveRun(latestRun, abortController);
            continue;
          }
          if (aborted && latestRun.status === "cancelled") {
            this.subagentService.clearActiveRun(latestRun, abortController);
            return;
          }

          const detail = error instanceof Error ? error.message : String(error);
          this.subagentService.markFailed(latestRun, detail, runtimeMs);
          this.chatHistory.push({
            role: "model",
            text: `Subagent ${latestRun.shortId} failed.\n\n${detail}`,
          });
          await this.persistAndBroadcastChatHistory();
          return;
        }
      }
    })();
  }

  private resolveSubagentInterruption(
    runId: string,
    observedGeneration: number,
    abortController: AbortController,
  ): "continue" | "return" | undefined {
    if (!abortController.signal.aborted) {
      return undefined;
    }

    const latestRun = this.subagentService.resolveRunToken(runId).run;
    if (!latestRun) {
      return "return";
    }

    if (latestRun.status === "cancelled") {
      this.subagentService.clearActiveRun(latestRun, abortController);
      return "return";
    }

    if (latestRun.generation !== observedGeneration) {
      this.subagentService.clearActiveRun(latestRun, abortController);
      return "continue";
    }

    return undefined;
  }

  private buildSubagentRuntimePrompt(run: SubagentRun): string {
    const sections = [
      "You are a background subagent working inside a VS Code assistant session.",
      "Stay focused on the assigned task, reason carefully, and return a concise but high-signal result.",
      "Do not ask the user for confirmation directly; the parent session will relay anything important.",
      "You may use available tools (built-in and MCP) when helpful.",
      `Subagent id: ${run.shortId}`,
      `Requested agent id: ${run.agentId}`,
      `Assigned task: ${run.task}`,
    ];

    if (run.parentContextSummary) {
      sections.push(`Parent context snapshot:\n${run.parentContextSummary}`);
    }
    if (run.steeringNotes.length > 0) {
      sections.push(`Steering notes:\n- ${run.steeringNotes.join("\n- ")}`);
    }
    const mcpPrompt = this.buildMcpAgentPrompt();
    if (mcpPrompt) {
      sections.push(mcpPrompt);
    }

    return sections.join("\n\n");
  }

  private renderSubagentCompletion(run: SubagentRun): string {
    const runtimeLabel = typeof run.runtimeMs === "number" ? `${run.runtimeMs} ms` : "unknown duration";
    return [
      `Subagent ${run.shortId} completed for "${run.agentId}" in ${runtimeLabel}.`,
      "",
      run.resultText ?? "(empty result)",
      "",
      `Transcript: ${run.transcriptPath}`,
    ].join("\n");
  }

  private buildSubagentParentContextSummary(): string {
    const recentMessages = this.chatHistory
      .slice(-8)
      .map((message, index) => `#${index + 1} ${message.role}\n${truncateText(serializeChatMessageForModel(message), 800)}`)
      .join("\n\n");
    if (!recentMessages) {
      return "No prior chat history.";
    }
    return recentMessages;
  }

  private buildSubagentState(): SubagentRunData[] {
    return this.subagentService.listRuns().map((run) => ({
      id: run.id,
      shortId: run.shortId,
      agentId: run.agentId,
      task: run.task,
      modelName: run.modelName,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      transcriptPath: run.transcriptPath,
      steeringNotes: [...run.steeringNotes],
      resultText: run.resultText,
      errorText: run.errorText,
      runtimeMs: run.runtimeMs,
      generation: run.generation,
      completedGeneration: run.completedGeneration,
      announcedGeneration: run.announcedGeneration,
      processing: run.processing,
      messageCount: run.messages.length,
      pendingApprovalCount: this.countPendingApprovalsForSubagent(run),
      logs: run.logs.map((entry) => ({
        timestamp: entry.timestamp,
        kind: entry.kind,
        message: entry.message,
      })),
    }));
  }

  private getToolCallsForSubagent(runId: string): ToolCallData[] {
    return this.chatHistory.flatMap((message) =>
      (message.toolCalls ?? []).filter((toolCall) => toolCall.subagentId === runId),
    );
  }

  private renderAllowlistReport(): string {
    const rows = this.mcpHub
      .getServers()
      .flatMap((server) =>
        this.mcpHub
          .getAllowlistEntries(server.name)
          .map((entry) => `${server.name} ${formatAllowlistEntry(entry)}`),
      )
      .sort((left, right) => left.localeCompare(right));

    if (rows.length === 0) {
      return [
        "The MCP allowlist is currently empty.",
        "",
        "Use `/allowlist add <server> <tool:...|prompt:...|resource:...> [scope=...]` to add a rule.",
      ].join("\n");
    }

    return [
      `MCP allowlist: ${rows.length}`,
      "",
      ...rows.map((row) => `- ${row}`),
    ].join("\n");
  }

  private countPendingApprovalsForSubagent(run: SubagentRun): number {
    return this.getToolCallsForSubagent(run.id).filter((toolCall) => toolCall.status === "pending").length;
  }

  private getPendingApprovalCalls(): Array<{ toolCall: ToolCallData; label: string }> {
    const pending: Array<{ toolCall: ToolCallData; label: string }> = [];
    for (const message of this.chatHistory) {
      for (const toolCall of message.toolCalls ?? []) {
        if (toolCall.status !== "pending") {
          continue;
        }
        pending.push({
          toolCall,
          label: formatToolCallLabel(toolCall),
        });
      }
    }
    return pending;
  }

  private renderPendingApprovalsReport(
    pending = this.getPendingApprovalCalls(),
  ): string {
    if (pending.length === 0) {
      return "There are no pending approvals right now.";
    }

    const lines = [
      `Pending approvals: ${pending.length}`,
      "",
    ];
    pending.forEach((entry, index) => {
      lines.push(
        `- #${index + 1} ${entry.toolCall.id.slice(0, 8)} ${entry.label} ${truncateText(JSON.stringify(entry.toolCall.parameters), 160)}`,
      );
    });
    lines.push("");
    lines.push("Approve with `/approve <id|#index> allow-once|allow-always|deny`.");
    return lines.join("\n");
  }

  private resolvePendingApprovalToken(
    token: string,
    pending = this.getPendingApprovalCalls(),
  ): { toolCall?: ToolCallData; error?: string } {
    const normalized = token.trim();
    if (!normalized) {
      return { error: "A pending approval id or #index is required." };
    }

    if (normalized.startsWith("#")) {
      const index = Number(normalized.slice(1));
      if (!Number.isInteger(index) || index < 1) {
        return { error: `Invalid approval index: ${normalized}` };
      }
      const entry = pending[index - 1];
      if (!entry) {
        return { error: `No pending approval matched ${normalized}.` };
      }
      return { toolCall: entry.toolCall };
    }

    const exact = pending.find((entry) => entry.toolCall.id === normalized);
    if (exact) {
      return { toolCall: exact.toolCall };
    }

    const prefixMatches = pending.filter((entry) => entry.toolCall.id.startsWith(normalized));
    if (prefixMatches.length === 1) {
      return { toolCall: prefixMatches[0].toolCall };
    }
    if (prefixMatches.length > 1) {
      return { error: `Approval token "${normalized}" matched multiple pending calls.` };
    }
    return { error: `No pending approval matched "${normalized}".` };
  }

  private renderCommandsHelp(): string {
    const lines = [
      "Available slash commands",
      "",
      "Built-in",
      "- `/help` or `/commands`: show this command list",
      "- `/skills`: list discovered agent skills",
      "- `/skills check`: show blockers and missing skill requirements",
      "- `/skills info <id>`: show detailed information for one skill",
      "- `/skills rules`: show security rule explanations and hit counts",
      "- `/skill <id> <task>`: invoke a skill by id",
      "- `/allowlist`: list MCP allowlist rules",
      "- `/allowlist add|remove <server> <tool:...|prompt:...|resource:...> [scope=main|subagents|subagent:<id>|all]`: manage the MCP allowlist",
      "- `/approve`: list pending approvals",
      "- `/approve <id|#index> allow-once|allow-always|deny`: resolve a pending approval",
      "- `/status`: show agent mode, MCP, and skills status",
      "- `/context [summary|detail|json]`: inspect the current chat/context footprint",
      "- `/mcp-prompt <server> <prompt> [name=value ...]`: preview a live MCP prompt",
      "- `/export-session [path]`: export the current chat transcript to HTML",
      "- `/subagents list|spawn|info|log|kill|send|steer`: manage background subagents",
      "- `/kill`, `/send`, `/steer`: shortcuts for the matching `/subagents` actions",
      "",
    ];

    const skillCommands = this.agentSkillService.getSlashCommands();
    if (skillCommands.length > 0) {
      lines.push("Skill commands");
      for (const command of skillCommands) {
        const suffix = command.kind === "tool-dispatch" ? " -> tool" : "";
        lines.push(`- \`/${command.command}\`: ${command.description ?? "Reusable skill"}${suffix}`);
      }
      lines.push("");
    }

    const promptCommands = this.mcpHub
      .getConnectedServers()
      .flatMap((server) =>
        server.prompts.map((prompt) => ({
          serverName: server.name,
          promptName: prompt.name,
          description: prompt.description,
        })),
      );
    if (promptCommands.length > 0) {
      lines.push("MCP prompts");
      for (const prompt of promptCommands) {
        lines.push(
          `- \`/mcp-prompt ${prompt.serverName} ${prompt.promptName}\`: ${prompt.description ?? "Preview prompt output"}`,
        );
      }
      lines.push("");
    }

    lines.push("Tip: direct skill slash commands come from SKILL directories and keep the current VSCode plugin flow intact.");
    return lines.join("\n");
  }

  private renderStatusReport(): string {
    const agentSettings = this.agentService.getSettings();
    const skillState = this.agentSkillService.getState();
    const servers = this.mcpHub.getServers();
    const connectedServers = servers.filter((server) => server.status === "connected");
    const connectedTools = connectedServers.reduce((sum, server) => sum + server.tools.length, 0);
    const connectedResources = connectedServers.reduce((sum, server) => sum + server.resources.length, 0);
    const connectedPrompts = connectedServers.reduce((sum, server) => sum + server.prompts.length, 0);
    const pendingApprovals = this.getPendingApprovalCalls();
    const subagents = this.subagentService.listRuns();
    const runningSubagents = subagents.filter((run) => run.status === "running" || run.status === "queued");

    return [
      `Status snapshot (${new Date().toISOString()})`,
      "",
      `Agent mode: ${agentSettings.mode}`,
      `Auto-action limit: ${agentSettings.maxAutoActions}`,
      `Chat messages: ${this.chatHistory.length}`,
      `Skills: ${skillState.skills.filter((skill) => skill.effectiveEnabled).length}/${skillState.skills.length} ready`,
      `MCP servers: ${connectedServers.length}/${servers.length} connected`,
      `MCP capabilities: ${connectedTools} tools, ${connectedResources} resources, ${connectedPrompts} prompts`,
      `Pending approvals: ${pendingApprovals.length}`,
      `Subagents: ${runningSubagents.length}/${subagents.length} active`,
      "",
      "Connected MCP servers",
      ...(connectedServers.length === 0
        ? ["- none"]
        : connectedServers.map(
            (server) =>
              `- ${server.name}: ${server.tools.length} tools, ${server.resources.length} resources, ${server.prompts.length} prompts`,
          )),
      "",
      "Pending approvals",
      ...(pendingApprovals.length === 0
        ? ["- none"]
        : pendingApprovals.map((entry, index) => `- #${index + 1} ${entry.label}`)),
      "",
      "Subagents",
      ...(subagents.length === 0
        ? ["- none"]
        : subagents.slice(0, 8).map((run) => `- ${run.shortId} [${run.status}] ${run.agentId}`)),
    ].join("\n");
  }

  private renderContextReport(rawArgs: string): string {
    const mode = normalizeSlashCommand(rawArgs || "summary");
    const messages = this.chatHistory.map((message, index) => {
      const serialized = serializeChatMessageForModel(message);
      return {
        index,
        role: message.role,
        chars: serialized.length,
        estimatedTokens: estimateTokens(serialized),
        hasImages: Boolean(message.images?.length),
        toolCalls: message.toolCalls?.length ?? 0,
      };
    });
    const configuredSystemPrompt = vscode.workspace.getConfiguration("ociAi").get<string>("systemPrompt", "").trim();
    const skillsManifest = this.agentSkillService.getState().skills
      .filter((skill) => skill.effectiveEnabled && skill.modelInvocable)
      .map((skill) => `${skill.id}: ${skill.description ?? skill.name}`)
      .join("\n");
    const mcpPrompt = this.buildMcpAgentPrompt();
    const contextSummary = {
      messages: {
        count: messages.length,
        estimatedTokens: messages.reduce((sum, message) => sum + message.estimatedTokens, 0),
      },
      configuredSystemPrompt: {
        chars: configuredSystemPrompt.length,
        estimatedTokens: estimateTokens(configuredSystemPrompt),
      },
      skillsManifest: {
        chars: skillsManifest.length,
        estimatedTokens: estimateTokens(skillsManifest),
      },
      mcpPrompt: {
        chars: mcpPrompt.length,
        estimatedTokens: estimateTokens(mcpPrompt),
      },
    };

    if (mode === "json") {
      return JSON.stringify(
        {
          summary: contextSummary,
          messages,
        },
        null,
        2,
      );
    }

    const lines = [
      "Context snapshot",
      "",
      `Messages: ${contextSummary.messages.count} (~${contextSummary.messages.estimatedTokens} tokens)`,
      `Configured system prompt: ${contextSummary.configuredSystemPrompt.chars} chars (~${contextSummary.configuredSystemPrompt.estimatedTokens} tokens)`,
      `Skills manifest: ${contextSummary.skillsManifest.chars} chars (~${contextSummary.skillsManifest.estimatedTokens} tokens)`,
      `MCP agent prompt: ${contextSummary.mcpPrompt.chars} chars (~${contextSummary.mcpPrompt.estimatedTokens} tokens)`,
    ];

    if (mode === "detail") {
      lines.push("");
      lines.push("Messages");
      for (const message of messages) {
        lines.push(
          `- #${message.index + 1} ${message.role}: ${message.chars} chars (~${message.estimatedTokens} tokens), toolCalls=${message.toolCalls}, images=${message.hasImages ? "yes" : "no"}`,
        );
      }
    } else {
      lines.push("");
      lines.push("Run `/context detail` for per-message detail or `/context json` for structured output.");
    }

    return lines.join("\n");
  }

  private async exportCurrentSession(rawArgs: string): Promise<string> {
    const requestedPath = rawArgs.trim();
    const targetPath = requestedPath
      ? path.resolve(requestedPath)
      : this.buildDefaultSessionExportPath();
    const directory = path.dirname(targetPath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(targetPath, renderChatHistoryHtml(this.chatHistory), "utf8");
    return `Exported the current session to:\n${targetPath}`;
  }

  private buildDefaultSessionExportPath(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const baseDirectory = workspaceRoot
      ? path.join(workspaceRoot, ".oci-ai", "exports")
      : path.join(os.tmpdir(), "oci-ai-exports");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(baseDirectory, `chat-session-${timestamp}.html`);
  }

  private renderMcpPromptPreview(
    serverName: string,
    promptName: string,
    promptArgs: Record<string, string>,
    promptResult: Awaited<ReturnType<McpHub["getPrompt"]>>,
  ): string {
    const lines = [
      `MCP prompt: ${serverName}/${promptName}`,
    ];
    if (Object.keys(promptArgs).length > 0) {
      lines.push(`Arguments: ${JSON.stringify(promptArgs)}`);
    }
    if (promptResult.description) {
      lines.push(`Description: ${promptResult.description}`);
    }
    lines.push("");
    if (promptResult.messages.length === 0) {
      lines.push("No prompt messages returned.");
      return lines.join("\n");
    }
    for (const message of promptResult.messages) {
      lines.push(`[${message.role}]`);
      for (const content of message.content) {
        if (content.type === "text" && content.text) {
          lines.push(content.text);
        } else if (content.type === "resource" && content.uri) {
          lines.push(`Resource: ${content.uri}`);
          if (content.text) {
            lines.push(content.text);
          }
        } else if (content.type === "image") {
          lines.push("[Image content]");
        }
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  private resolveConnectedMcpTool(toolSpecifier: string):
    | { serverName: string; tool: ReturnType<McpHub["getConnectedTools"]>[number]["tool"] }
    | undefined {
    const spec = toolSpecifier.trim();
    if (!spec) {
      return undefined;
    }

    const separatorMatch = spec.match(/^([^/:]+)[/:]([\s\S]+)$/);
    if (separatorMatch) {
      const serverName = separatorMatch[1];
      const toolName = separatorMatch[2];
      return this.mcpHub
        .getConnectedTools()
        .find((entry) => entry.serverName === serverName && entry.tool.name === toolName);
    }

    const matches = this.mcpHub.getConnectedTools().filter((entry) => entry.tool.name === spec);
    if (matches.length === 1) {
      return matches[0];
    }
    return undefined;
  }

  private buildDispatchedToolArgs(
    turnContext: Extract<SkillTurnContext, { kind: "tool-dispatch" }>,
  ): Record<string, unknown> {
    switch (turnContext.commandArgMode) {
      case "raw":
      default:
        return {
          command: turnContext.argumentText.trim(),
          commandName: turnContext.slashCommandName,
          skillName: turnContext.skillName,
        };
    }
  }

  private shouldUseAgentMcpLoop(): boolean {
    // Agent loop is available when MCP servers are connected OR when agent
    // mode is explicitly enabled (built-in tools work without MCP).
    if (this.mcpHub.getConnectedServers().length > 0) {
      return true;
    }
    return this.agentService.getSettings().mode === "agent";
  }

  private buildModelMessagesFromChatHistory(): ChatMessage[] {
    return this.chatHistory.map((message) => ({
      role: message.role,
      text: serializeChatMessageForModel(message),
      images: message.role === "user" ? message.images : undefined,
    }));
  }

  private buildMcpAgentPrompt(): string {
    const settings = this.agentService.getSettings();
    const servers = this.mcpHub.getConnectedServers();
    const builtinDefs = getBuiltinToolDefinitions().filter((t) => {
      // listFiles/searchFiles gated by readFile; fetchUrl gated by webSearch
      const gateMap: Record<string, string> = {
        listFiles: "readFile",
        searchFiles: "readFile",
        fetchUrl: "webSearch",
      };
      const gateKey = (gateMap[t.name] ?? t.name) as keyof typeof settings.enabledTools;
      return settings.enabledTools[gateKey] !== false;
    });
    const hasBuiltins = builtinDefs.length > 0;
    const hasMcp = servers.length > 0;

    // -- Bootstrap context (persona, user profile, workspace memory) --
    const bootstrapSection = this.agentBootstrapService.buildSystemPromptSection();

    if (!hasBuiltins && !hasMcp && !bootstrapSection) {
      return "";
    }

    const lines: string[] = [];

    // -- Agent identity & behaviour guidance (OpenClaw-style) --
    lines.push(
      "You are a coding assistant with tool-use capabilities.",
      "When you need to interact with the file system, run commands, or search code, use the tools below.",
      "After receiving a tool result, continue working toward the user's goal — call more tools if needed or provide a final answer.",
      "Think step-by-step: understand the request, gather context via tools, then act.",
      "",
    );

    // -- Tool calling format instructions --
    lines.push("# Tool calling format");
    if (hasBuiltins) {
      lines.push(
        "For built-in tools, use this XML format:",
        "<use_tool><tool_name>toolName</tool_name><arguments>{\"key\":\"value\"}</arguments></use_tool>",
      );
    }
    if (hasMcp) {
      lines.push(
        "For MCP server tools, use these XML formats:",
        "<use_mcp_tool><server_name>server</server_name><tool_name>tool</tool_name><arguments>{\"key\":\"value\"}</arguments></use_mcp_tool>",
        "<use_mcp_prompt><server_name>server</server_name><prompt_name>prompt</prompt_name><arguments>{\"key\":\"value\"}</arguments></use_mcp_prompt>",
        "<access_mcp_resource><server_name>server</server_name><uri>resource-uri</uri></access_mcp_resource>",
      );
    }
    lines.push(
      "The <arguments> value must be valid JSON object text.",
      "Emit exactly one XML tool block per response turn.",
      "When no tool action is needed, answer normally with no XML block.",
      "After a tool result is returned, continue from that new context.",
      "",
    );

    lines.push(
      "# Skills",
      "If a later runtime prompt includes <available_skills>, scan that list before replying.",
      "If the user asks what skills are available, answer from that list directly.",
      "If exactly one skill clearly applies, follow that skill's workflow first.",
      "If multiple skills could apply, choose the most specific one.",
      "If no skill clearly applies, do not force one.",
      "",
    );

    // -- Built-in tools --
    if (hasBuiltins) {
      lines.push("# Built-in tools");
      lines.push("<available_tools>");
      for (const tool of builtinDefs) {
        lines.push(`  <tool name="${escapeXmlAttribute(tool.name)}">`);
        lines.push(`    <description>${escapeXmlText(tool.description)}</description>`);
        lines.push(`    <input_schema>${escapeXmlText(JSON.stringify(tool.inputSchema))}</input_schema>`);
        lines.push("  </tool>");
      }
      lines.push("</available_tools>");
      lines.push("");
    }

    // -- MCP servers --
    if (hasMcp) {
      lines.push("# MCP servers");
      lines.push("<available_mcp_servers>");
      for (const server of servers) {
        lines.push(`  <server name="${escapeXmlAttribute(server.name)}">`);
        if (server.tools.length === 0 && server.resources.length === 0 && server.prompts.length === 0) {
          lines.push("    <capabilities>none discovered</capabilities>");
        }
        for (const tool of server.tools) {
          lines.push(`    <tool name="${escapeXmlAttribute(tool.name)}">`);
          if (tool.description) {
            lines.push(`      <description>${escapeXmlText(tool.description)}</description>`);
          }
          if (tool.inputSchema) {
            lines.push(`      <input_schema>${escapeXmlText(JSON.stringify(tool.inputSchema))}</input_schema>`);
          }
          lines.push("    </tool>");
        }
        for (const resource of server.resources) {
          lines.push(`    <resource uri="${escapeXmlAttribute(resource.uri)}" name="${escapeXmlAttribute(resource.name)}">`);
          if (resource.description) {
            lines.push(`      <description>${escapeXmlText(resource.description)}</description>`);
          }
          lines.push("    </resource>");
        }
        for (const prompt of server.prompts) {
          lines.push(`    <prompt name="${escapeXmlAttribute(prompt.name)}">`);
          if (prompt.description) {
            lines.push(`      <description>${escapeXmlText(prompt.description)}</description>`);
          }
          for (const argument of prompt.arguments ?? []) {
            lines.push(
              `      <argument name="${escapeXmlAttribute(argument.name)}" required="${argument.required ? "true" : "false"}">${escapeXmlText(argument.description ?? "")}</argument>`,
            );
          }
          lines.push("    </prompt>");
        }
        lines.push("  </server>");
      }
      lines.push("</available_mcp_servers>");
    }

    // -- Bootstrap files (persona / workspace context) --
    if (bootstrapSection) {
      lines.push("");
      lines.push(bootstrapSection);
    }

    return lines.join("\n");
  }

  private async runAgentMcpLoop(options: {
    active: ActiveChatRequest;
    modelName?: string;
    runtimeSystemPrompt?: string;
  }): Promise<void> {
    const maxActions = Math.max(1, this.agentService.getSettings().maxAutoActions || 10);
    const workingMessages = this.buildModelMessagesFromChatHistory();
    let actionCount = 0;
    let parseRepairCount = 0;

    while (!options.active.cancelled) {
      let assistantText = "";
      await this.streamAssistantModelResponse(
        workingMessages,
        (token) => {
          assistantText += token;
        },
        {
          signal: options.active.abortController.signal,
          modelName: options.modelName,
          runtimeSystemPrompt: options.runtimeSystemPrompt,
        },
      );

      if (options.active.cancelled) {
        return;
      }

      const parsed = parseAssistantMcpActions(assistantText);
      if (parsed.repairPrompt && parsed.actions.length === 0) {
        if (
          await this.queueMcpParserRepair({
            workingMessages,
            parsed,
            parseRepairCount,
          })
        ) {
          parseRepairCount += 1;
          continue;
        }
      }

      if (parsed.actions.length === 0) {
        const finalText =
          parsed.displayText ||
          (parsed.repairPrompt
            ? "I hit an MCP formatting issue before any tool call could be executed. Please try again."
            : assistantText.trim());
        if (finalText) {
          this.chatHistory.push({ role: "model", text: finalText });
          await this.persistAndBroadcastChatHistory();
        }
        return;
      }
      parseRepairCount = 0;

      const agentMessage: ChatMessageData = {
        role: "model",
        text: parsed.displayText || "Using tools to gather the next piece of context.",
        toolCalls: parsed.actions.map((action) => action.toolCall),
      };
      this.chatHistory.push(agentMessage);
      await this.persistAndBroadcastChatHistory();

      workingMessages.push({
        role: "model",
        text: formatMcpRequestForModel(agentMessage.text, parsed.actions),
      });

      const toolResultMessages: string[] = [];
      for (const action of parsed.actions) {
        actionCount += 1;
        const result = await this.executeAgentMcpAction(action, options.active.abortController.signal, { requester: "main" });
        toolResultMessages.push(formatMcpResultForModel(action, result));

        if (options.active.cancelled) {
          return;
        }

        if (actionCount >= maxActions) {
          const limitMessage =
            "Stopped after reaching the configured tool action limit. Review the tool results above and continue if you want another step.";
          this.chatHistory.push({ role: "model", text: limitMessage });
          await this.persistAndBroadcastChatHistory();
          return;
        }
      }

      workingMessages.push({
        role: "user",
        text: `${toolResultMessages.join("\n\n")}\n\nContinue helping the user.`,
      });
    }
  }

  private async queueMcpParserRepair(options: {
    workingMessages: ChatMessage[];
    parsed: ParsedAssistantMcpActions;
    parseRepairCount: number;
    subagentRun?: SubagentRun;
  }): Promise<boolean> {
    if (!options.parsed.repairPrompt || options.parseRepairCount >= MAX_MCP_PARSE_REPAIR_ATTEMPTS) {
      return false;
    }

    options.workingMessages.push({
      role: "user",
      text: options.parsed.repairPrompt,
    });

    if (options.subagentRun) {
      this.subagentService.appendLog(
        options.subagentRun,
        "tool",
        "Requested MCP XML repair after a malformed tool block.",
      );
    }

    return true;
  }

  private async executeAgentMcpAction(
    action: AgentToolExecution,
    signal?: AbortSignal,
    context: McpExecutionContext = { requester: "main" },
  ): Promise<ToolCallResult> {
    const toolCall = action.toolCall;
    const subagentLabel = context.subagentRun?.agentId;
    if (subagentLabel) {
      toolCall.subagentId = context.subagentRun?.id;
      toolCall.subagentLabel = subagentLabel;
    }
    const alwaysApproved =
      // Built-in tools use AgentService auto-approval settings
      (action.kind === "builtin"
        ? this.agentService.shouldAutoApprove(toolCall.toolName)
        : this.agentService.shouldAutoApprove(toolCall.toolName, toolCall.serverName)) ||
      (toolCall.serverName
        ? this.mcpHub.isActionAutoApproved(
            toolCall.serverName,
            toAllowlistAction(action),
            {
              requester: context.requester,
              subagentId: normalizeAllowlistSubagentToken(context.subagentRun?.agentId),
            },
          )
        : false);

    if (alwaysApproved) {
      toolCall.status = "approved";
      toolCall.updatedAt = new Date().toISOString();
      if (context.subagentRun) {
        this.subagentService.appendLog(
          context.subagentRun,
          "approval",
          `Auto-approved ${formatToolCallLabel(toolCall)}.`,
        );
      }
      await this.persistAndBroadcastChatHistory();
    } else {
      toolCall.status = "pending";
      toolCall.updatedAt = new Date().toISOString();
      if (context.subagentRun) {
        this.subagentService.appendLog(
          context.subagentRun,
          "approval",
          `Waiting for approval: ${formatToolCallLabel(toolCall)}.`,
        );
      }
      await this.persistAndBroadcastChatHistory();

      const approval = await this.agentService.requestApproval(toolCall.id, signal);
      if (!approval.approved) {
        toolCall.status = "denied";
        toolCall.updatedAt = new Date().toISOString();
        toolCall.result = {
          isError: true,
          content: [
            {
              type: "text",
              text: "Tool execution was denied by the user.",
            },
          ],
        };
        if (context.subagentRun) {
          this.subagentService.appendLog(
            context.subagentRun,
            "approval",
            `Denied ${formatToolCallLabel(toolCall)}.`,
          );
        }
        await this.persistAndBroadcastChatHistory();
        return toolCall.result;
      }

      if (approval.alwaysAllow && toolCall.serverName) {
        await this.mcpHub.toggleAllowlistEntry(
          toolCall.serverName,
          buildAllowlistEntryForAction(action, context),
          true,
        );
      }

      toolCall.status = "approved";
      toolCall.updatedAt = new Date().toISOString();
      if (context.subagentRun) {
        this.subagentService.appendLog(
          context.subagentRun,
          "approval",
          approval.alwaysAllow
            ? `Approved ${formatToolCallLabel(toolCall)} and persisted it to the allowlist.`
            : `Approved ${formatToolCallLabel(toolCall)}.`,
        );
      }
      await this.persistAndBroadcastChatHistory();
    }

    toolCall.status = "running";
    toolCall.updatedAt = new Date().toISOString();
    if (context.subagentRun) {
      this.subagentService.appendLog(
        context.subagentRun,
        "tool",
        `Running ${formatToolCallLabel(toolCall)} with ${truncateText(JSON.stringify(toolCall.parameters), 240)}.`,
      );
    }
    await this.persistAndBroadcastChatHistory();

    const execution = await this.executeAgentMcpActionWithRetry(action, signal, context);
    const result = execution.result;
    toolCall.attemptCount = execution.attemptCount;
    toolCall.result = result;
    toolCall.status = result.isError ? "error" : "completed";
    toolCall.updatedAt = new Date().toISOString();
    if (context.subagentRun) {
      this.subagentService.appendLog(
        context.subagentRun,
        result.isError ? "error" : "tool",
        `${formatToolCallLabel(toolCall)} -> ${truncateText(summarizeToolResult(result), 600)}`,
      );
    }
    await this.persistAndBroadcastChatHistory();
    return result;
  }

  private async executeAgentMcpActionWithRetry(
    action: AgentToolExecution,
    signal: AbortSignal | undefined,
    context: McpExecutionContext,
  ): Promise<{ result: ToolCallResult; attemptCount: number }> {
    let attemptCount = 0;
    let lastResult: ToolCallResult | undefined;

    while (attemptCount < MAX_MCP_EXECUTION_ATTEMPTS) {
      attemptCount += 1;
      if (signal?.aborted) {
        throw new Error("Request aborted.");
      }

      lastResult = await this.invokeAgentMcpAction(action);
      if (!lastResult.isError || !shouldRetryMcpResult(action, lastResult) || attemptCount >= MAX_MCP_EXECUTION_ATTEMPTS) {
        return {
          result: lastResult,
          attemptCount,
        };
      }

      if (context.subagentRun) {
        this.subagentService.appendLog(
          context.subagentRun,
          "tool",
          `Retrying ${formatToolCallLabel(action.toolCall)} after a transient MCP failure.`,
        );
      }

      if (action.kind !== "builtin" && action.serverName && shouldRestartMcpServerBeforeRetry(lastResult)) {
        try {
          await this.mcpHub.restartServer(action.serverName);
        } catch {
          // Fall back to a timed retry even if reconnect fails.
        }
      }

      await delayWithAbort(MCP_RETRY_BACKOFF_MS * attemptCount, signal);
    }

    return {
      result:
        lastResult ?? {
          isError: true,
          content: [{ type: "text", text: "MCP execution failed before a result was returned." }],
        },
      attemptCount,
    };
  }

  private async invokeAgentMcpAction(action: AgentToolExecution): Promise<ToolCallResult> {
    try {
      // Built-in tool execution (no MCP server needed)
      if (action.kind === "builtin") {
        const enabledTools: AgentEnabledTools = this.agentService.getSettings().enabledTools;
        if (!isBuiltinToolEnabled(action.toolName, enabledTools)) {
          return {
            isError: true,
            content: [{ type: "text", text: `Built-in tool "${action.toolName}" is disabled in settings.` }],
          };
        }
        return await executeBuiltinTool(action.toolName, action.args);
      }

      if (action.kind === "tool") {
        const initialResult = await this.mcpHub.callTool(action.serverName, action.toolName, action.args);
        return await this.expandFetchToolResult(action, initialResult);
      }
      if (action.kind === "prompt") {
        const promptResult = await this.mcpHub.getPrompt(action.serverName, action.promptName, action.args);
        return {
          content: promptResult.messages.flatMap((message) => {
            const sections = [`[${message.role}]`];
            for (const entry of message.content) {
              if (entry.type === "text" && entry.text) {
                sections.push(entry.text);
              } else if (entry.type === "resource" && entry.uri) {
                sections.push(`Resource: ${entry.uri}`);
                if (entry.text) {
                  sections.push(entry.text);
                }
              } else if (entry.type === "image") {
                sections.push("[Image content]");
              }
            }
            return [{ type: "text" as const, text: sections.join("\n") }];
          }),
        };
      }
      return await this.mcpHub.readResource(action.serverName, action.uri);
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  private async expandFetchToolResult(
    action: Extract<AgentToolExecution, { kind: "tool" }>,
    initialResult: ToolCallResult,
  ): Promise<ToolCallResult> {
    if (initialResult.isError || action.toolName.trim().toLowerCase() !== "fetch") {
      return initialResult;
    }

    const paginationSettings = readMcpFetchAutoPaginationSettings();
    if (paginationSettings.mcpFetchAutoPaginationMaxHops <= 0) {
      return initialResult;
    }

    const firstContinuation = extractFetchContinuationStartIndex(initialResult);
    if (firstContinuation === null) {
      return initialResult;
    }

    const mergedTextParts = [stripFetchContinuationNotice(readToolResultText(initialResult))];
    const seenStartIndexes = new Set<number>([firstContinuation]);
    let continuationStartIndex: number | null = firstContinuation;
    let hopCount = 0;
    let stopNote = "";

    while (
      continuationStartIndex !== null &&
      hopCount < paginationSettings.mcpFetchAutoPaginationMaxHops
    ) {
      const accumulatedChars = mergedTextParts.reduce((total, part) => total + part.length, 0);
      if (accumulatedChars >= paginationSettings.mcpFetchAutoPaginationMaxTotalChars) {
        stopNote =
          `\n\n[fetch auto-pagination stopped after ${accumulatedChars} chars to keep MCP context bounded. ` +
          `Resume with start_index=${continuationStartIndex} if more content is needed.]`;
        break;
      }

      hopCount += 1;
      const nextResult = await this.mcpHub.callTool(action.serverName, action.toolName, {
        ...action.args,
        start_index: continuationStartIndex,
      });
      if (nextResult.isError) {
        stopNote =
          `\n\n[fetch auto-pagination stopped at start_index=${continuationStartIndex} because the follow-up call failed: ` +
          `${truncateText(summarizeToolResult(nextResult), 500)}]`;
        break;
      }

      mergedTextParts.push(stripFetchContinuationNotice(readToolResultText(nextResult)));

      const nextContinuation = extractFetchContinuationStartIndex(nextResult);
      if (nextContinuation === null) {
        continuationStartIndex = null;
        break;
      }
      if (seenStartIndexes.has(nextContinuation)) {
        stopNote =
          `\n\n[fetch auto-pagination stopped because the server repeated start_index=${nextContinuation}.]`;
        break;
      }

      seenStartIndexes.add(nextContinuation);
      continuationStartIndex = nextContinuation;
    }

    if (!stopNote && continuationStartIndex !== null) {
      stopNote =
        `\n\n[fetch auto-pagination stopped after ${paginationSettings.mcpFetchAutoPaginationMaxHops} follow-up calls. ` +
        `Resume with start_index=${continuationStartIndex} if more content is needed.]`;
    }

    const mergedText = `${mergedTextParts.join("")}${stopNote}`.trim();
    if (!mergedText) {
      return initialResult;
    }

    return {
      content: [{ type: "text", text: mergedText }],
    };
  }

  private persistChatHistory(): void {
    if (!this.workspaceState) return;
    // Keep persisted state lightweight by excluding large image payloads.
    const toSave = this.chatHistory.slice(-MAX_PERSISTED_MESSAGES).map((m) => ({
      role: m.role,
      text: m.text,
      toolCalls: m.toolCalls?.map((toolCall) => ({
        ...toolCall,
        result: toolCall.result
          ? {
              ...toolCall.result,
              content: toolCall.result.content.map((item) =>
                item.type === "image"
                  ? {
                      ...item,
                      dataUrl: undefined,
                    }
                  : item,
              ),
            }
          : undefined,
      })),
    }));
    this.workspaceState.update(CHAT_HISTORY_KEY, toSave);
  }

  private async persistAndBroadcastChatHistory(): Promise<void> {
    this.persistChatHistory();
    await this.broadcastState();
  }

  private async recordSqlHistory(entry: {
    sql: string;
    connectionType: SqlWorkbenchConnectionType;
    targetId?: string;
    targetName?: string;
    serviceName?: string;
    username?: string;
  }): Promise<void> {
    const sql = String(entry.sql ?? "").trim();
    if (!sql) {
      return;
    }

    const historyEntry: SqlHistoryEntry = {
      id: randomUUID(),
      sql,
      executedAt: new Date().toISOString(),
      connectionType: entry.connectionType,
      targetId: String(entry.targetId ?? "").trim() || undefined,
      targetName: String(entry.targetName ?? "").trim() || undefined,
      serviceName: String(entry.serviceName ?? "").trim() || undefined,
      username: String(entry.username ?? "").trim() || undefined,
    };

    this.sqlHistory = [historyEntry, ...this.sqlHistory.filter((item) => item.sql !== sql)].slice(0, MAX_SQL_HISTORY_ITEMS);
    await this.persistSqlWorkbenchState();
    await this.broadcastState();
  }

  private async persistSqlWorkbenchState(): Promise<void> {
    if (!this.workspaceState) {
      return;
    }
    await this.workspaceState.update(SQL_WORKBENCH_STATE_KEY, {
      history: this.sqlHistory,
      favorites: this.sqlFavorites,
    } satisfies SqlWorkbenchState);
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
      this.codeContextSubscribers.delete(requestId) ||
      this.mcpServerSubscribers.delete(requestId) ||
      this.skillSubscribers.delete(requestId) ||
      this.skillOverviewSubscribers.delete(requestId);
    return removed;
  }

  /** List compute instances */
  public async listComputeInstances(): Promise<{ id: string; name: string; lifecycleState: string }[]> {
    return this.ociService.listComputeInstances();
  }

  public async listBastionTargetInstances(
    request: import("../shared/services").ListBastionTargetInstancesRequest
  ): Promise<import("../shared/services").ListBastionTargetInstancesResponse> {
    const compartmentIds = Array.isArray(request.compartmentIds)
      ? request.compartmentIds.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
      : [];
    if (compartmentIds.length === 0) {
      return { instances: [] };
    }
    const lifecycleStates = Array.isArray(request.lifecycleStates)
      ? request.lifecycleStates.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
      : [];
    const instances = await this.ociService.listComputeInstancesForBastionTargets({
      compartmentIds,
      region: normalizeOptionalRegion(request.region),
      vcnId: typeof request.vcnId === "string" ? request.vcnId.trim() || undefined : undefined,
      lifecycleStates,
    });
    return { instances };
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
    const response = await this.adbSqlService.executeSql(request);
    await this.recordSqlHistory({
      sql: request.sql,
      connectionType: request.connectionType ?? "adb",
      targetId: request.targetId,
      targetName: request.targetName,
      serviceName: request.serviceName,
      username: request.username,
    });
    return response;
  }

  public async explainAdbSqlPlan(request: ExplainSqlPlanRequest): Promise<ExplainSqlPlanResponse> {
    const response = await this.adbSqlService.explainSqlPlan(request);
    await this.recordSqlHistory({
      sql: request.sql,
      connectionType: request.connectionType ?? "adb",
      targetId: request.targetId,
      targetName: request.targetName,
      serviceName: request.serviceName,
      username: request.username,
    });
    return response;
  }

  public async testAdbConnection(request: ConnectAdbRequest): Promise<TestSqlConnectionResponse> {
    return this.adbSqlService.testAdbConnection(request);
  }

  /** Switch active compartment and broadcast updated state */
  public async switchCompartment(id: string): Promise<void> {
    await this.authManager.updateCompartmentId(id);
    await this.broadcastState();
  }

  /** Reuse the existing command flow so title, state, and resource refresh stay in sync. */
  public async switchProfile(): Promise<void> {
    await vscode.commands.executeCommand("ociAi.auth.configureProfile");
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
    const response = await this.adbSqlService.executeDbSystemSql(request);
    await this.recordSqlHistory({
      sql: request.sql,
      connectionType: request.connectionType ?? "dbSystem",
      targetId: request.targetId,
      targetName: request.targetName,
      serviceName: request.serviceName,
      username: request.username,
    });
    return response;
  }

  public async explainDbSystemSqlPlan(request: ExplainSqlPlanRequest): Promise<ExplainSqlPlanResponse> {
    const response = await this.adbSqlService.explainSqlPlan(request);
    await this.recordSqlHistory({
      sql: request.sql,
      connectionType: request.connectionType ?? "dbSystem",
      targetId: request.targetId,
      targetName: request.targetName,
      serviceName: request.serviceName,
      username: request.username,
    });
    return response;
  }

  public async testDbSystemConnection(request: import("../shared/services").ConnectDbSystemRequest): Promise<TestSqlConnectionResponse> {
    return this.adbSqlService.testDbSystemConnection(request);
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

  public async saveSqlFavorite(request: SaveSqlFavoriteRequest): Promise<void> {
    const label = String(request.label ?? "").trim();
    const sql = String(request.sql ?? "").trim();
    if (!label) {
      throw new Error("Favorite label is required.");
    }
    if (!sql) {
      throw new Error("Favorite SQL is required.");
    }

    const id = String(request.id ?? "").trim() || randomUUID();
    const favorite: SqlFavoriteEntry = {
      id,
      label,
      sql,
      description: String(request.description ?? "").trim() || undefined,
      connectionType: request.connectionType,
      targetId: String(request.targetId ?? "").trim() || undefined,
      targetName: String(request.targetName ?? "").trim() || undefined,
    };
    this.sqlFavorites = [favorite, ...this.sqlFavorites.filter((entry) => entry.id !== id)].slice(0, MAX_SQL_FAVORITES);
    await this.persistSqlWorkbenchState();
    await this.broadcastState();
  }

  public async deleteSqlFavorite(request: DeleteSqlFavoriteRequest): Promise<void> {
    const id = String(request.id ?? "").trim();
    if (!id) {
      return;
    }
    this.sqlFavorites = this.sqlFavorites.filter((entry) => entry.id !== id);
    await this.persistSqlWorkbenchState();
    await this.broadcastState();
  }

  public async clearSqlHistory(): Promise<void> {
    this.sqlHistory = [];
    await this.persistSqlWorkbenchState();
    await this.broadcastState();
  }

  public async requestSqlAssistant(request: SqlAssistantRequest): Promise<SqlAssistantResponse> {
    const mode = request.mode === "optimize" ? "optimize" : "generate";
    const prompt = String(request.prompt ?? "").trim();
    const currentSql = String(request.sql ?? "").trim();
    const schemaContext = String(request.schemaContext ?? "").trim();
    const targetName = String(request.targetName ?? "").trim();

    if (!prompt && !currentSql) {
      throw new Error("Please provide a request or SQL to analyze.");
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const modelName = cfg.get<string>("genAiLlmModelId", "").trim() || cfg.get<string>("genAiModelId", "").trim();
    if (!modelName) {
      return {
        content: "Configure `ociAi.genAiLlmModelId` before using the AI SQL assistant.",
      };
    }

    let content = "";
    await this.genAiService.chatStream(
      [
        {
          role: "user",
          text: buildSqlAssistantPrompt({
            mode,
            prompt,
            currentSql,
            schemaContext,
            connectionType: request.connectionType,
            targetName,
          }),
        },
      ],
      (token) => {
        content += token;
      },
      {},
    );

    return {
      content: content.trim(),
      suggestedSql: extractFirstSqlBlock(content),
    };
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

  public async listObjectStorageBuckets(): Promise<import("../types").ObjectStorageBucketResource[]> {
    return this.ociService.listObjectStorageBuckets();
  }

  public async listSpeechBuckets(): Promise<import("../types").ObjectStorageBucketResource[]> {
    return this.ociService.listSpeechBuckets();
  }

  public async listObjectStorageObjects(request: import("../shared/services").ListObjectStorageObjectsRequest): Promise<ListObjectStorageObjectsResponse> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    if (!namespaceName || !bucketName) {
      throw new Error("namespaceName and bucketName are required.");
    }
    return this.ociService.listObjectStorageObjects(
      namespaceName,
      bucketName,
      normalizeObjectStoragePrefix(request.prefix),
      typeof request.region === "string" ? request.region : undefined,
      request.recursive === true
    );
  }

  public async listSpeechObjects(request: import("../shared/services").ListObjectStorageObjectsRequest): Promise<ListObjectStorageObjectsResponse> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    if (!namespaceName || !bucketName) {
      throw new Error("namespaceName and bucketName are required.");
    }
    return this.ociService.listSpeechObjects(namespaceName, bucketName, normalizeObjectStoragePrefix(request.prefix));
  }

  public async uploadObjectStorageObject(
    request: import("../shared/services").UploadObjectStorageObjectRequest
  ): Promise<UploadObjectStorageObjectResponse> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    if (!namespaceName || !bucketName) {
      throw new Error("namespaceName and bucketName are required.");
    }

    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Upload to Object Storage",
      title: `Upload file to ${bucketName}`,
    });
    const fileUri = picked?.[0];
    if (!fileUri) {
      return { objectName: "", cancelled: true };
    }

    const inputName = String(request.objectName ?? "").trim();
    const prefix = normalizeObjectStoragePrefix(request.prefix);
    const objectName = inputName || `${prefix}${path.basename(fileUri.fsPath)}`;
    const content = await vscode.workspace.fs.readFile(fileUri);

    await this.ociService.uploadObjectStorageObject(
      namespaceName,
      bucketName,
      objectName,
      content,
      typeof request.region === "string" ? request.region : undefined
    );
    return { objectName, objectSize: content.byteLength };
  }

  public async downloadObjectStorageObject(request: DownloadObjectStorageObjectRequest): Promise<DownloadObjectStorageObjectResponse> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    const objectName = String(request.objectName ?? "").trim();
    if (!namespaceName || !bucketName || !objectName) {
      throw new Error("namespaceName, bucketName, and objectName are required.");
    }

    const targetUri = await vscode.window.showSaveDialog({
      title: `Save ${path.basename(objectName)}`,
      saveLabel: "Download Object",
      defaultUri: vscode.Uri.file(path.join(os.homedir(), path.basename(objectName))),
    });
    if (!targetUri) {
      return { cancelled: true };
    }

    const content = await this.ociService.downloadObjectStorageObject(
      namespaceName,
      bucketName,
      objectName,
      typeof request.region === "string" ? request.region : undefined
    );
    await vscode.workspace.fs.writeFile(targetUri, content);
    return { cancelled: false };
  }

  public async readObjectStorageObjectText(
    request: ReadObjectStorageObjectTextRequest
  ): Promise<ReadObjectStorageObjectTextResponse> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    const objectName = String(request.objectName ?? "").trim();
    if (!namespaceName || !bucketName || !objectName) {
      throw new Error("namespaceName, bucketName, and objectName are required.");
    }

    return this.ociService.readObjectStorageObjectText(
      namespaceName,
      bucketName,
      objectName,
      typeof request.region === "string" ? request.region : undefined,
      typeof request.maxBytes === "number" ? request.maxBytes : undefined
    );
  }

  public async deleteObjectStorageObject(
    request: import("../shared/services").DeleteObjectStorageObjectRequest
  ): Promise<void> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    const objectName = String(request.objectName ?? "").trim();
    if (!namespaceName || !bucketName || !objectName) {
      throw new Error("namespaceName, bucketName, and objectName are required.");
    }

    await this.ociService.deleteObjectStorageObject(
      namespaceName,
      bucketName,
      objectName,
      typeof request.region === "string" ? request.region : undefined
    );
  }

  public async createObjectStoragePar(
    request: import("../shared/services").CreateObjectStorageParRequest
  ): Promise<CreateObjectStorageParResponse> {
    const namespaceName = String(request.namespaceName ?? "").trim();
    const bucketName = String(request.bucketName ?? "").trim();
    const objectName = String(request.objectName ?? "").trim();
    if (!namespaceName || !bucketName || !objectName) {
      throw new Error("namespaceName, bucketName, and objectName are required.");
    }
    return this.ociService.createObjectStoragePreauthenticatedRequest(
      namespaceName,
      bucketName,
      objectName,
      typeof request.expiresInHours === "number" ? request.expiresInHours : undefined,
      typeof request.region === "string" ? request.region : undefined
    );
  }

  public async listSpeechTranscriptionJobs(): Promise<ListSpeechTranscriptionJobsResponse> {
    const jobs = await this.ociService.listSpeechTranscriptionJobs();
    return { jobs };
  }

  public async getSpeechTranscriptionJob(transcriptionJobId: string): Promise<GetSpeechTranscriptionJobResponse> {
    const trimmedJobId = String(transcriptionJobId ?? "").trim();
    if (!trimmedJobId) {
      throw new Error("transcriptionJobId is required.");
    }
    const job = await this.ociService.getSpeechTranscriptionJob(trimmedJobId);
    return { job };
  }

  public async createSpeechTranscriptionJob(
    request: CreateSpeechTranscriptionJobRequest
  ): Promise<CreateSpeechTranscriptionJobResponse> {
    const compartmentId = String(request.compartmentId ?? "").trim();
    const inputNamespaceName = String(request.inputNamespaceName ?? "").trim();
    const inputBucketName = String(request.inputBucketName ?? "").trim();
    const outputNamespaceName = String(request.outputNamespaceName ?? "").trim();
    const outputBucketName = String(request.outputBucketName ?? "").trim();
    const inputObjectNames = Array.isArray(request.inputObjectNames)
      ? request.inputObjectNames.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
      : [];
    const requestedModelType = String(request.modelType ?? "").trim().toUpperCase();
    const modelType = requestedModelType === "WHISPER_LARGE_V3_TURBO" ? "WHISPER_LARGE_V3T" : requestedModelType;
    const languageCode = String(request.languageCode ?? "").trim().toLowerCase();

    if (!compartmentId) {
      throw new Error("compartmentId is required.");
    }
    if (!inputNamespaceName || !inputBucketName || inputObjectNames.length === 0) {
      throw new Error("Select at least one input object from Object Storage.");
    }
    if (inputObjectNames.length > MAX_SPEECH_OBJECTS_PER_JOB) {
      throw new Error(`OCI Speech accepts up to ${MAX_SPEECH_OBJECTS_PER_JOB} input files per job.`);
    }
    if (!outputNamespaceName || !outputBucketName) {
      throw new Error("Output bucket is required.");
    }
    if (modelType !== "WHISPER_MEDIUM" && modelType !== "WHISPER_LARGE_V3T") {
      throw new Error(`Unsupported Speech model: ${modelType || "unknown"}.`);
    }
    if (languageCode !== "ja" && languageCode !== "en" && languageCode !== "zh") {
      throw new Error(`Unsupported Speech language: ${languageCode || "unknown"}.`);
    }
    if (String(request.whisperPrompt ?? "").trim().length > MAX_WHISPER_PROMPT_LENGTH) {
      throw new Error(`Whisper prompt must be ${MAX_WHISPER_PROMPT_LENGTH} characters or fewer.`);
    }

    const profanityFilterMode = request.profanityFilterMode === "MASK" ? "MASK" : undefined;
    const job = await this.ociService.createSpeechTranscriptionJob({
      compartmentId,
      displayName: String(request.displayName ?? "").trim(),
      description: String(request.description ?? "").trim(),
      inputNamespaceName,
      inputBucketName,
      inputObjectNames,
      outputNamespaceName,
      outputBucketName,
      outputPrefix: String(request.outputPrefix ?? "").trim(),
      modelType,
      languageCode,
      includeSrt: Boolean(request.includeSrt),
      enablePunctuation: true,
      enableDiarization: Boolean(request.enableDiarization),
      profanityFilterMode,
      whisperPrompt: String(request.whisperPrompt ?? ""),
    });
    return { job };
  }

  public async cancelSpeechTranscriptionJob(transcriptionJobId: string): Promise<void> {
    const trimmedJobId = String(transcriptionJobId ?? "").trim();
    if (!trimmedJobId) {
      throw new Error("transcriptionJobId is required.");
    }
    await this.ociService.cancelSpeechTranscriptionJob(trimmedJobId);
  }

  public async deleteSpeechTranscriptionJob(transcriptionJobId: string): Promise<void> {
    const trimmedJobId = String(transcriptionJobId ?? "").trim();
    if (!trimmedJobId) {
      throw new Error("transcriptionJobId is required.");
    }
    await this.ociService.deleteSpeechTranscriptionJob(trimmedJobId);
  }

  public async listSpeechTranscriptionTasks(transcriptionJobId: string): Promise<ListSpeechTranscriptionTasksResponse> {
    const trimmedJobId = String(transcriptionJobId ?? "").trim();
    if (!trimmedJobId) {
      throw new Error("transcriptionJobId is required.");
    }
    const tasks = await this.ociService.listSpeechTranscriptionTasks(trimmedJobId);
    return { tasks };
  }

  public async listBastions(): Promise<import("../shared/services").ListBastionsResponse> {
    const bastions = await this.ociService.listBastions();
    return { bastions };
  }

  public async listBastionSessions(
    request: import("../shared/services").ListBastionSessionsRequest
  ): Promise<import("../shared/services").ListBastionSessionsResponse> {
    const bastionId = String(request.bastionId ?? "").trim();
    if (!bastionId) {
      throw new Error("bastionId is required.");
    }
    const sessions = await this.ociService.listBastionSessions(bastionId, normalizeOptionalRegion(request.region));
    return { sessions };
  }

  public async createBastionSession(
    request: import("../shared/services").CreateBastionSessionRequest
  ): Promise<void> {
    const bastionId = String(request.bastionId ?? "").trim();
    if (!bastionId) {
      throw new Error("bastionId is required.");
    }
    const rawTargetResourceDetails = ensureObjectPayload(request.targetResourceDetails, "targetResourceDetails");
    const keyDetails = ensureObjectPayload(request.keyDetails, "keyDetails");
    const sessionType = typeof rawTargetResourceDetails.sessionType === "string" ? rawTargetResourceDetails.sessionType.trim() : "";
    if (!sessionType) {
      throw new Error("targetResourceDetails.sessionType is required.");
    }
    if (sessionType !== "MANAGED_SSH" && sessionType !== "PORT_FORWARDING") {
      throw new Error(`Unsupported Bastion sessionType: ${sessionType}`);
    }
    const targetResourceDetails: Record<string, unknown> = {
      ...rawTargetResourceDetails,
      sessionType,
    };
    if (sessionType === "MANAGED_SSH") {
      const targetResourceId = typeof rawTargetResourceDetails.targetResourceId === "string"
        ? rawTargetResourceDetails.targetResourceId.trim()
        : "";
      const osUserName = typeof rawTargetResourceDetails.targetResourceOperatingSystemUserName === "string"
        ? rawTargetResourceDetails.targetResourceOperatingSystemUserName.trim()
        : "";
      if (!targetResourceId) {
        throw new Error("targetResourceDetails.targetResourceId is required for managed SSH.");
      }
      if (!osUserName) {
        throw new Error("targetResourceDetails.targetResourceOperatingSystemUserName is required for managed SSH.");
      }
      targetResourceDetails.targetResourceId = targetResourceId;
      targetResourceDetails.targetResourceOperatingSystemUserName = osUserName;
      delete targetResourceDetails.targetResourcePrivateIpAddress;
      delete targetResourceDetails.targetResourcePort;
    }
    if (sessionType === "PORT_FORWARDING") {
      const targetResourceId = typeof rawTargetResourceDetails.targetResourceId === "string"
        ? rawTargetResourceDetails.targetResourceId.trim()
        : "";
      const targetPrivateIp = typeof rawTargetResourceDetails.targetResourcePrivateIpAddress === "string"
        ? rawTargetResourceDetails.targetResourcePrivateIpAddress.trim()
        : "";
      if (!targetResourceId && !targetPrivateIp) {
        throw new Error("Port forwarding requires targetResourceId or targetResourcePrivateIpAddress.");
      }
      const targetResourcePort = normalizePositiveNumber(
        rawTargetResourceDetails.targetResourcePort,
        "targetResourceDetails.targetResourcePort",
      );
      if (typeof targetResourcePort === "undefined") {
        throw new Error("targetResourceDetails.targetResourcePort is required for port forwarding.");
      }
      targetResourceDetails.targetResourcePort = targetResourcePort;
      if (targetResourceId) {
        targetResourceDetails.targetResourceId = targetResourceId;
      } else {
        delete targetResourceDetails.targetResourceId;
      }
      if (targetPrivateIp) {
        targetResourceDetails.targetResourcePrivateIpAddress = targetPrivateIp;
      } else {
        delete targetResourceDetails.targetResourcePrivateIpAddress;
      }
      delete targetResourceDetails.targetResourceOperatingSystemUserName;
    }
    const publicKeyContent = typeof keyDetails.publicKeyContent === "string" ? keyDetails.publicKeyContent.trim() : "";
    if (!publicKeyContent) {
      throw new Error("keyDetails.publicKeyContent is required.");
    }
    const sessionTtlInSeconds = normalizePositiveNumber(request.sessionTtlInSeconds, "sessionTtlInSeconds");
    const displayName = typeof request.displayName === "string" ? request.displayName.trim() || undefined : undefined;
    await this.ociService.createBastionSession(
      bastionId,
      targetResourceDetails,
      { ...keyDetails, publicKeyContent },
      sessionTtlInSeconds,
      displayName,
      normalizeOptionalRegion(request.region)
    );
  }

  public async deleteBastionSession(
    request: import("../shared/services").DeleteBastionSessionRequest
  ): Promise<void> {
    const sessionId = String(request.sessionId ?? "").trim();
    if (!sessionId) {
      throw new Error("sessionId is required.");
    }
    await this.ociService.deleteBastionSession(sessionId, normalizeOptionalRegion(request.region));
  }

  public async runBastionSshCommand(request: RunBastionSshCommandRequest): Promise<RunBastionSshCommandResponse> {
    const executable = String(request.executable ?? "").trim();
    const args = Array.isArray(request.args) ? request.args.map((value) => String(value ?? "")) : [];
    if (!executable) {
      throw new Error("SSH executable is required.");
    }
    if (args.length === 0) {
      throw new Error("SSH arguments are required.");
    }

    const taskScope =
      vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.TaskScope.Workspace
        : vscode.TaskScope.Global;

    const task = new vscode.Task(
      { type: "ociAiBastionSsh", sessionId: request.sessionId || executable, _ts: Date.now() },
      taskScope,
      `Bastion SSH: ${String(request.sessionName ?? "").trim() || String(request.bastionName ?? "").trim() || request.sessionId || "Session"}`,
      "OCI AI",
      new vscode.ShellExecution(executable, args)
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

  // --- OCA Proxy ---

  public async getOcaProxyStatus(): Promise<OcaProxyStatus> {
    return this.ocaProxyManager.getStatus();
  }

  public async startOcaAuth(): Promise<void> {
    await this.ocaProxyManager.startAuth();
  }

  public async logoutOca(): Promise<void> {
    await this.ocaProxyManager.logout();
  }

  public async fetchOcaModels(): Promise<OcaFetchModelsResponse> {
    const models = await this.ocaProxyManager.fetchModels();
    return { models };
  }

  public async saveOcaProxyConfig(request: OcaProxySaveConfigRequest): Promise<void> {
    await this.ocaProxyManager.saveConfig(request);
  }

  public async generateOcaApiKey(): Promise<OcaGenerateApiKeyResponse> {
    const apiKey = await this.ocaProxyManager.generateNewApiKey();
    return { apiKey };
  }

  public async startOcaProxy(): Promise<void> {
    await this.ocaProxyManager.startProxy();
  }

  public async stopOcaProxy(): Promise<void> {
    await this.ocaProxyManager.stopProxy();
  }

  // --- MCP Methods ---

  public getMcpServers(): McpServerState[] {
    return this.mcpHub.getServers();
  }

  public async addMcpServer(request: AddMcpServerRequest): Promise<void> {
    await this.mcpHub.addServer(request);
  }

  public async updateMcpServer(request: UpdateMcpServerRequest): Promise<void> {
    await this.mcpHub.updateServer(request);
  }

  public async removeMcpServer(name: string): Promise<void> {
    await this.mcpHub.removeServer(name);
  }

  public async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    await this.mcpHub.toggleServer(name, enabled);
  }

  public async restartMcpServer(name: string): Promise<void> {
    await this.mcpHub.restartServer(name);
  }

  public async toggleMcpToolAutoApprove(request: ToggleMcpToolAutoApproveRequest): Promise<void> {
    await this.mcpHub.toggleToolAutoApprove(request.serverName, request.toolName, request.approved);
  }

  public async previewMcpPrompt(request: McpPromptPreviewRequest): Promise<McpPromptPreviewResponse> {
    const serverName = String(request.serverName ?? "").trim();
    const promptName = String(request.promptName ?? "").trim();
    if (!serverName || !promptName) {
      throw new Error("Both server name and prompt name are required.");
    }

    const args = normalizeStringMap(request.args);
    const promptResult = await this.mcpHub.getPrompt(serverName, promptName, args);
    return {
      serverName,
      promptName,
      args,
      description: promptResult.description,
      messages: promptResult.messages,
      previewText: this.renderMcpPromptPreview(serverName, promptName, args, promptResult),
    };
  }

  public async previewMcpResource(request: McpResourcePreviewRequest): Promise<McpResourcePreviewResponse> {
    const serverName = String(request.serverName ?? "").trim();
    const uri = String(request.uri ?? "").trim();
    if (!serverName || !uri) {
      throw new Error("Both server name and resource URI are required.");
    }

    const result = await this.mcpHub.readResource(serverName, uri);
    return {
      serverName,
      uri,
      result,
      previewText: summarizeToolResult(result),
    };
  }

  public subscribeToMcpServers(
    requestId: string,
    handler: StreamingResponseHandler<{ servers: McpServerState[] }>
  ): void {
    this.mcpServerSubscribers.set(requestId, handler);
    // Send initial state
    handler({ servers: this.mcpHub.getServers() }).catch(() => {});
  }

  // --- Agent Methods ---

  public getAgentSettings(): AgentSettings {
    return this.agentService.getSettings();
  }

  public async saveAgentSettings(settings: AgentSettings): Promise<void> {
    await this.agentService.saveSettings(settings);
    await this.broadcastState();
  }

  public resolveToolApproval(response: ToolApprovalResponse): void {
    this.agentService.resolveApproval(response);
  }

  // --- Agent Bootstrap Methods ---

  public getBootstrapState(): BootstrapState | undefined {
    return this.agentBootstrapService.getState();
  }

  public async ensureBootstrapFiles(firstRun = false): Promise<string | undefined> {
    return this.agentBootstrapService.ensureWorkspaceFiles(firstRun);
  }

  // --- Agent Skill Methods ---

  public getAgentSkills(): AgentSkillsState {
    return this.agentSkillService.getState();
  }

  public getAgentSkillsDiagnosticReport(): AgentSkillsDiagnosticReport {
    return this.agentSkillService.getDiagnosticReport();
  }

  public getAgentSkillsOverview(): AgentSkillsOverview {
    return this.agentSkillService.getOverview();
  }

  public getAgentSkillInfoReport(skillRef: string): AgentSkillInfoReport | undefined {
    return this.agentSkillService.getSkillInfoReport(skillRef);
  }

  public getAgentSkillsCheckReport(): AgentSkillsCheckReport {
    return this.agentSkillService.getSkillsCheckReport();
  }

  public async openAgentSkillFindingLocation(
    file: string,
    line: number,
  ): Promise<AgentSkillFindingLocationResponse> {
    const normalizedFile = String(file ?? "").trim();
    const normalizedLine = Math.max(1, Number.isFinite(line) ? Math.floor(line) : 1);
    if (!normalizedFile) {
      throw new Error("A finding file path is required.");
    }

    const document = await vscode.workspace.openTextDocument(normalizedFile);
    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    const targetLine = Math.min(Math.max(0, normalizedLine - 1), Math.max(0, document.lineCount - 1));
    const position = new vscode.Position(targetLine, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

    return {
      opened: true,
      file: normalizedFile,
      line: normalizedLine,
    };
  }

  public async addAgentSkillSuppression(params: {
    scope: AgentSkillSuppressionScope
    ruleId?: string
    file?: string
    note?: string
  }): Promise<void> {
    await this.agentSkillService.addSuppression(params)
  }

  public async removeAgentSkillSuppression(params: {
    scope: AgentSkillSuppressionScope
    ruleId?: string
    file?: string
  }): Promise<void> {
    await this.agentSkillService.removeSuppression(params)
  }

  public async setAgentSkillSuppressions(suppressions: import("../shared/mcp-types").AgentSkillSuppression[]): Promise<void> {
    await this.agentSkillService.setSuppressions(suppressions)
  }

  public subscribeToAgentSkills(
    requestId: string,
    handler: StreamingResponseHandler<AgentSkillsState>
  ): void {
    this.skillSubscribers.set(requestId, handler);
    handler(this.agentSkillService.getState()).catch(() => {});
  }

  public subscribeToAgentSkillsOverview(
    requestId: string,
    handler: StreamingResponseHandler<AgentSkillsOverview>,
  ): void {
    this.skillOverviewSubscribers.set(requestId, handler);
    handler(this.agentSkillService.getOverview()).catch(() => {});
  }

  public async refreshAgentSkills(): Promise<void> {
    this.agentSkillService.refresh();
  }

  public async toggleAgentSkill(skillId: string, enabled: boolean): Promise<void> {
    await this.agentSkillService.toggleSkill(skillId, enabled);
  }

  public async installAgentSkill(
    skillId: string,
    installerId?: string,
    allowHighRisk = false,
  ): Promise<AgentSkillInstallResult> {
    return this.agentSkillService.installSkill(skillId, installerId, allowHighRisk);
  }

  public async importAgentSkillFromSource(
    source: string,
    scope: AgentSkillImportScope,
    replaceExisting = false,
    allowHighRisk = false,
  ): Promise<AgentSkillImportResult> {
    return this.agentSkillService.importSkillFromSource(source, scope, replaceExisting, allowHighRisk);
  }

  public async pickAgentSkillImportSource(): Promise<AgentSkillImportPickerResult> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use As Skill Source",
      title: "Choose an external skill source",
      filters: {
        Archives: ["zip", "tar.gz", "tgz", "tar.bz2", "tbz2"],
      },
    });
    const target = picked?.[0]?.fsPath;
    if (!target) {
      return { cancelled: true };
    }
    return { cancelled: false, path: target };
  }

  public async sendSubagentMessage(request: SubagentMessageRequest): Promise<void> {
    const resolved = this.subagentService.resolveRunToken(String(request.runId ?? ""));
    if (!resolved.run) {
      throw new Error(resolved.error ?? "Subagent not found.");
    }
    this.subagentService.queueUserMessage(resolved.run, String(request.message ?? ""));
    this.driveSubagentRun(resolved.run.id);
  }

  public async steerSubagent(request: SubagentMessageRequest): Promise<void> {
    const resolved = this.subagentService.resolveRunToken(String(request.runId ?? ""));
    if (!resolved.run) {
      throw new Error(resolved.error ?? "Subagent not found.");
    }
    this.subagentService.queueSteering(resolved.run, String(request.message ?? ""));
    this.driveSubagentRun(resolved.run.id);
  }

  public async killSubagent(request: SubagentKillRequest): Promise<void> {
    const normalized = String(request.runId ?? "").trim();
    if (!normalized) {
      throw new Error("A subagent id is required.");
    }
    if (normalizeSlashCommand(normalized) === "all") {
      const runs = this.subagentService.listRuns().filter((run) => run.status === "running" || run.status === "queued");
      runs.forEach((run) => {
        this.subagentService.cancelRun(run, "Cancelled from the subagent inspector.");
      });
      return;
    }
    const resolved = this.subagentService.resolveRunToken(normalized);
    if (!resolved.run) {
      throw new Error(resolved.error ?? "Subagent not found.");
    }
    this.subagentService.cancelRun(resolved.run, "Cancelled from the subagent inspector.");
  }

  public async getSubagentTranscript(request: SubagentTranscriptRequest): Promise<SubagentTranscriptResponse> {
    const resolved = this.subagentService.resolveRunToken(String(request.runId ?? ""));
    if (!resolved.run) {
      throw new Error(resolved.error ?? "Subagent not found.");
    }

    return {
      runId: resolved.run.id,
      transcriptPath: resolved.run.transcriptPath,
      transcript: this.subagentService.getTranscript(resolved.run),
      updatedAt: resolved.run.updatedAt,
    };
  }

  public async runMcpSmokeTest(): Promise<McpSmokeTestResult> {
    return this.mcpHub.runSmokeTest({
      transportType: "streamableHttp",
      timeout: 15,
    });
  }

  public dispose(): void {
    this.mcpHub.dispose();
    this.agentService.dispose();
    this.agentSkillService.dispose();
    this.agentBootstrapService.dispose();
  }
}

function normalizeOptionalRegion(region: unknown): string | undefined {
  if (typeof region !== "string") {
    return undefined;
  }
  const trimmed = region.trim();
  return trimmed || undefined;
}

function normalizePositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return normalized;
}

function ensureObjectPayload(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
  return value as Record<string, unknown>;
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

function serializeChatMessageForModel(message: ChatMessageData): string {
  const sections: string[] = [];
  const trimmedText = message.text.trim();
  if (trimmedText) {
    sections.push(trimmedText);
  }

  if (message.toolCalls?.length) {
    const toolLines: string[] = ["[MCP activity]"];
    for (const toolCall of message.toolCalls) {
      toolLines.push(`- ${formatToolCallLabel(toolCall)} (${toolCall.status})`);
      if (Object.keys(toolCall.parameters).length > 0) {
        toolLines.push(`  parameters: ${JSON.stringify(toolCall.parameters)}`);
      }
      if (toolCall.result) {
        toolLines.push(`  result: ${summarizeToolResult(toolCall.result)}`);
      }
    }
    sections.push(toolLines.join("\n"));
  }

  return sections.join("\n\n").trim();
}

function parseAssistantMcpActions(rawText: string): ParsedAssistantMcpActions {
  const actions: AgentToolExecution[] = [];
  const parserErrors: string[] = [];
  const createdAt = new Date().toISOString();
  const displaySegments: string[] = [];
  // Match both built-in <use_tool> and MCP tags
  const pattern =
    /<(use_tool|use_mcp_tool|use_mcp_prompt|access_mcp_resource|use_mcp_resource)>([\s\S]*?)(<\/\1>|(?=<(?:use_tool|use_mcp_tool|use_mcp_prompt|access_mcp_resource|use_mcp_resource)>|$))/gi;
  let cursor = 0;

  for (const match of rawText.matchAll(pattern)) {
    const blockStart = match.index ?? 0;
    displaySegments.push(rawText.slice(cursor, blockStart));
    cursor = blockStart + match[0].length;

    const tagName = String(match[1] ?? "").trim().toLowerCase();
    const body = String(match[2] ?? "");
    const parsed = parseAssistantMcpActionBlock(tagName, body, createdAt);
    if (parsed.action) {
      actions.push(parsed.action);
    } else if (parsed.error) {
      parserErrors.push(parsed.error);
    }
  }

  displaySegments.push(rawText.slice(cursor));
  const displayText = displaySegments.join("").replace(/\n{3,}/g, "\n\n").trim();

  return {
    displayText,
    actions,
    repairPrompt: actions.length === 0 && parserErrors.length > 0 ? buildMcpRepairPrompt(parserErrors) : undefined,
  };
}

function parseAssistantMcpActionBlock(
  tagName: string,
  body: string,
  createdAt: string,
): { action?: AgentToolExecution; error?: string } {
  // Built-in tool: <use_tool>
  if (tagName === "use_tool") {
    const toolName = extractXmlTag(body, ["tool_name", "tool", "toolName", "name"]);
    const parsedArgs = parseMcpArguments(extractXmlTag(body, ["arguments", "args", "parameters"]) ?? "{}");

    if (!toolName) {
      return { error: "A <use_tool> block must include a <tool_name>." };
    }
    if (!parsedArgs.ok) {
      return { error: `Could not parse arguments for built-in tool ${toolName}: ${parsedArgs.error}` };
    }
    const toolArgs = parsedArgs.value as Record<string, unknown>;

    const toolCall: ToolCallData = {
      id: randomUUID(),
      toolName,
      createdAt,
      updatedAt: createdAt,
      actionKind: "tool",
      actionTarget: toolName,
      parameters: toolArgs,
      status: "pending",
    };

    return {
      action: {
        kind: "builtin",
        toolCall,
        toolName,
        args: toolArgs,
      },
    };
  }

  if (tagName === "use_mcp_tool") {
    const serverName = extractXmlTag(body, ["server_name", "server", "serverName"]);
    const toolName = extractXmlTag(body, ["tool_name", "tool", "toolName", "name"]);
    const parsedArgs = parseMcpArguments(extractXmlTag(body, ["arguments", "args", "parameters"]) ?? "{}");

    if (!serverName || !toolName) {
      return { error: "A <use_mcp_tool> block must include both <server_name> and <tool_name>." };
    }
    if (!parsedArgs.ok) {
      return { error: `Could not parse arguments for ${serverName}/${toolName}: ${parsedArgs.error}` };
    }
    const toolArgs = parsedArgs.value as Record<string, unknown>;

    const toolCall: ToolCallData = {
      id: randomUUID(),
      toolName,
      serverName,
      createdAt,
      updatedAt: createdAt,
      actionKind: "tool",
      actionTarget: toolName,
      parameters: toolArgs,
      status: "pending",
    };

    return {
      action: {
        kind: "tool",
        toolCall,
        serverName,
        toolName,
        args: toolArgs,
      },
    };
  }

  if (tagName === "use_mcp_prompt") {
    const serverName = extractXmlTag(body, ["server_name", "server", "serverName"]);
    const promptName = extractXmlTag(body, ["prompt_name", "prompt", "promptName", "name"]);
    const parsedArgs = parseMcpArguments(extractXmlTag(body, ["arguments", "args", "parameters"]) ?? "{}", true);

    if (!serverName || !promptName) {
      return { error: "A <use_mcp_prompt> block must include both <server_name> and <prompt_name>." };
    }
    if (!parsedArgs.ok) {
      return { error: `Could not parse arguments for prompt ${serverName}/${promptName}: ${parsedArgs.error}` };
    }
    const promptArgs = parsedArgs.value as Record<string, string>;

    const toolCall: ToolCallData = {
      id: randomUUID(),
      toolName: "getPrompt",
      serverName,
      createdAt,
      updatedAt: createdAt,
      actionKind: "prompt",
      actionTarget: promptName,
      parameters: {
        promptName,
        arguments: promptArgs,
      },
      status: "pending",
    };

    return {
      action: {
        kind: "prompt",
        toolCall,
        serverName,
        promptName,
        args: promptArgs,
      },
    };
  }

  if (tagName === "access_mcp_resource" || tagName === "use_mcp_resource") {
    const serverName = extractXmlTag(body, ["server_name", "server", "serverName"]);
    const uri = extractXmlTag(body, ["uri", "resource_uri", "resourceUri"]);

    if (!serverName || !uri) {
      return { error: "An MCP resource block must include both <server_name> and <uri>." };
    }

    const toolCall: ToolCallData = {
      id: randomUUID(),
      toolName: "readResource",
      serverName,
      createdAt,
      updatedAt: createdAt,
      actionKind: "resource",
      actionTarget: uri,
      parameters: { uri },
      status: "pending",
    };

    return {
      action: {
        kind: "resource",
        toolCall,
        serverName,
        uri,
      },
    };
  }

  return { error: `Unsupported MCP action tag: ${tagName}` };
}

function extractXmlTag(body: string, tagNames: string | string[]): string | undefined {
  const candidates = Array.isArray(tagNames) ? tagNames : [tagNames];
  for (const tagName of candidates) {
    const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i");
    const match = body.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return decodeXmlEntities(value);
    }
  }
  return undefined;
}

function parseMcpArguments(
  rawValue: string,
  stringifyValues = false,
): { ok: true; value: Record<string, unknown> | Record<string, string> } | { ok: false; error: string } {
  const normalized = normalizeMcpArgumentsPayload(rawValue);
  if (!normalized) {
    return { ok: true, value: {} };
  }

  for (const candidate of buildArgumentParseCandidates(normalized)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ok: true,
          value: stringifyValues
            ? Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]))
            : (parsed as Record<string, unknown>),
        };
      }
    } catch {
      // Fall through to the next parse strategy.
    }
  }

  const keyValueArgs = parseKeyValueArgumentString(normalized);
  if (keyValueArgs) {
    return {
      ok: true,
      value: stringifyValues
        ? Object.fromEntries(Object.entries(keyValueArgs).map(([key, value]) => [key, String(value ?? "")]))
        : keyValueArgs,
    };
  }

  return {
    ok: false,
    error: `unsupported argument payload: ${truncateText(normalized, 180)}`,
  };
}

function normalizeMcpArgumentsPayload(rawValue: string): string {
  let normalized = decodeXmlEntities(rawValue).trim();
  if (!normalized) {
    return "";
  }

  const fencedMatch = normalized.match(/^```(?:json|javascript|js|ts|typescript)?\s*([\s\S]*?)```$/i);
  if (fencedMatch) {
    normalized = fencedMatch[1].trim();
  }

  return normalized;
}

function buildArgumentParseCandidates(normalized: string): string[] {
  const candidates = new Set<string>();
  candidates.add(normalized);

  let repaired = normalized
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z0-9_\-$]+)\s*:/g, '$1"$2":');
  repaired = repaired.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, value: string) =>
    JSON.stringify(value.replace(/\\'/g, "'")),
  );
  candidates.add(repaired);

  return Array.from(candidates);
}

function parseKeyValueArgumentString(rawValue: string): Record<string, unknown> | undefined {
  const matches = rawValue.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (matches.length === 0 || matches.some((token) => !token.includes("="))) {
    return undefined;
  }

  const entries = matches
    .map((token) => {
      const separatorIndex = token.indexOf("=");
      if (separatorIndex <= 0) {
        return undefined;
      }
      const key = token.slice(0, separatorIndex).trim();
      const raw = token.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      return key ? [key, coerceArgumentScalar(raw)] : undefined;
    })
    .filter((entry): entry is [string, unknown] => Boolean(entry));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function coerceArgumentScalar(rawValue: string): unknown {
  const normalized = rawValue.trim();
  if (!normalized) {
    return "";
  }
  if (/^(true|false)$/i.test(normalized)) {
    return /^true$/i.test(normalized);
  }
  if (/^null$/i.test(normalized)) {
    return null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }
  return normalized;
}

function buildMcpRepairPrompt(errors: string[]): string {
  const lines = [
    "Your previous response attempted to use a tool XML block, but it could not be parsed.",
    "Reply again using either plain text only or corrected XML only.",
    "Valid forms:",
    "- <use_tool><tool_name>...</tool_name><arguments>{...}</arguments></use_tool>",
    "- <use_mcp_tool><server_name>...</server_name><tool_name>...</tool_name><arguments>{...}</arguments></use_mcp_tool>",
    "- <use_mcp_prompt><server_name>...</server_name><prompt_name>...</prompt_name><arguments>{...}</arguments></use_mcp_prompt>",
    "- <access_mcp_resource><server_name>...</server_name><uri>...</uri></access_mcp_resource>",
    "Parser notes:",
    ...errors.slice(0, 3).map((error) => `- ${error}`),
  ];
  return lines.join("\n");
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function formatMcpRequestForModel(narration: string, actions: AgentToolExecution[]): string {
  const sections = [narration.trim() || "Requested tool action."];
  for (const action of actions) {
    if (action.kind === "builtin") {
      sections.push(
        `[Requested tool]\nTool: ${action.toolName}\nArguments: ${JSON.stringify(action.args)}`,
      );
    } else if (action.kind === "tool") {
      sections.push(
        `[Requested MCP tool]\nServer: ${action.serverName}\nTool: ${action.toolName}\nArguments: ${JSON.stringify(action.args)}`,
      );
    } else if (action.kind === "prompt") {
      sections.push(
        `[Requested MCP prompt]\nServer: ${action.serverName}\nPrompt: ${action.promptName}\nArguments: ${JSON.stringify(action.args)}`,
      );
    } else if (action.kind === "resource") {
      sections.push(`[Requested MCP resource]\nServer: ${action.serverName}\nURI: ${action.uri}`);
    }
  }
  return sections.join("\n\n").trim();
}

function formatMcpResultForModel(action: AgentToolExecution, result: ToolCallResult): string {
  let header: string;
  if (action.kind === "builtin") {
    header = `[Tool result]\nTool: ${action.toolName}`;
  } else if (action.kind === "tool") {
    header = `[MCP tool result]\nServer: ${action.serverName}\nTool: ${action.toolName}`;
  } else if (action.kind === "prompt") {
    header = `[MCP prompt result]\nServer: ${action.serverName}\nPrompt: ${action.promptName}`;
  } else if (action.kind === "resource") {
    header = `[MCP resource result]\nServer: ${action.serverName}\nURI: ${action.uri}`;
  } else {
    header = `[Tool result]\nTool: unknown`;
  }

  return `${header}\nStatus: ${result.isError ? "error" : "success"}\nResult:\n${summarizeToolResult(result)}`;
}

function summarizeToolResult(result: ToolCallResult): string {
  const segments = result.content.map((item) => {
    if (item.type === "text") {
      return item.text ?? "";
    }
    if (item.type === "image") {
      return `[image result${item.mimeType ? `: ${item.mimeType}` : ""}]`;
    }
    if (item.type === "resource") {
      const resourceBits = [item.uri ? `uri=${item.uri}` : "", item.text ?? ""].filter(Boolean);
      return resourceBits.join("\n");
    }
    return "";
  });

  const joined = segments.filter(Boolean).join("\n\n").trim();
  if (!joined) {
    return "(empty result)";
  }
  if (joined.length <= 4000) {
    return joined;
  }

  const head = joined.slice(0, 2400).trimEnd();
  const tail = joined.slice(-1200).trimStart();
  const omittedChars = joined.length - head.length - tail.length;
  return `${head}\n\n[... ${omittedChars} chars omitted ...]\n\n${tail}`;
}

function readToolResultText(result: ToolCallResult): string {
  return result.content
    .map((item) => {
      if (item.type === "text") {
        return item.text ?? "";
      }
      if (item.type === "resource") {
        return item.text ?? "";
      }
      return "";
    })
    .join("");
}

function extractFetchContinuationStartIndex(result: ToolCallResult): number | null {
  const match = readToolResultText(result).match(
    /Content truncated\.\s*Call the fetch tool with a start_index of\s+(\d+)\s+to get more content\./i,
  );
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function stripFetchContinuationNotice(text: string): string {
  return text
    .replace(
      /(?:<error>\s*)?Content truncated\.\s*Call the fetch tool with a start_index of\s+\d+\s+to get more content\.(?:\s*<\/error>)?/gi,
      "",
    )
    .trimEnd();
}

function shouldRetryMcpResult(action: AgentToolExecution, result: ToolCallResult): boolean {
  if (!result.isError) {
    return false;
  }

  const summary = summarizeToolResult(result).toLowerCase();
  if (!summary || isClearlyTerminalMcpError(summary)) {
    return false;
  }

  if (isConnectivityStyleMcpError(summary)) {
    return true;
  }

  if (action.kind === "tool" || action.kind === "resource" || action.kind === "prompt") {
    return /\b(429|5\d\d)\b/.test(summary) || /temporar|try again|rate limit|unavailable/.test(summary);
  }

  return false;
}

function shouldRestartMcpServerBeforeRetry(result: ToolCallResult): boolean {
  if (!result.isError) {
    return false;
  }
  return isConnectivityStyleMcpError(summarizeToolResult(result).toLowerCase());
}

function isConnectivityStyleMcpError(summary: string): boolean {
  return /(timeout|timed out|etimedout|econnreset|connection reset|connection closed|socket hang up|network|temporarily unavailable|not connected|disconnected|transport|stream closed|broken pipe|eof)/.test(
    summary,
  );
}

function isClearlyTerminalMcpError(summary: string): boolean {
  return /(not found|unknown tool|unknown prompt|unknown resource|invalid|missing required|permission denied|forbidden|unauthorized|denied by the user|parse error|schema)/.test(
    summary,
  );
}

async function delayWithAbort(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw new Error("Request aborted.");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Request aborted."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeSlashCommand(value: string): string {
  return value.trim().toLowerCase();
}

function toAllowlistAction(action: AgentToolExecution): McpAllowlistAction {
  if (action.kind === "builtin" || action.kind === "tool") {
    return {
      kind: "tool",
      name: action.toolName,
    };
  }
  if (action.kind === "prompt") {
    return {
      kind: "prompt",
      name: action.promptName,
    };
  }
  return {
    kind: "resource",
    uri: action.uri,
  };
}

function buildAllowlistEntryForAction(action: AgentToolExecution, context: McpExecutionContext): string {
  const scope =
    context.requester === "main"
      ? "main"
      : context.subagentRun?.agentId
        ? (`subagent:${normalizeAllowlistSubagentToken(context.subagentRun.agentId)}` as const)
        : "subagents";

  const rule =
    action.kind === "builtin" || action.kind === "tool"
      ? action.toolName
      : action.kind === "prompt"
        ? `prompt:${action.promptName}`
        : `resource:${action.uri}`;

  return canonicalizeAllowlistEntry(rule, scope) ?? rule;
}

function formatToolCallLabel(toolCall: ToolCallData): string {
  const baseLabel = (() => {
    if (!toolCall.serverName) {
      return toolCall.toolName;
    }

    if (toolCall.actionKind === "prompt") {
      return `${toolCall.serverName}/prompt:${toolCall.actionTarget ?? toolCall.toolName}`;
    }
    if (toolCall.actionKind === "resource") {
      return `${toolCall.serverName}/resource:${toolCall.actionTarget ?? toolCall.toolName}`;
    }
    if (toolCall.actionKind === "tool") {
      return `${toolCall.serverName}/tool:${toolCall.actionTarget ?? toolCall.toolName}`;
    }
    return `${toolCall.serverName}/${toolCall.toolName}`;
  })();

  return toolCall.subagentLabel ? `${baseLabel} [subagent:${toolCall.subagentLabel}]` : baseLabel;
}

type AllowlistScope = "all" | "main" | "subagents" | `subagent:${string}`;

function normalizeAllowlistScope(rawValue: string): AllowlistScope | undefined {
  const normalized = normalizeSlashCommand(rawValue || "all");
  if (!normalized || normalized === "all") {
    return "all";
  }
  if (normalized === "main" || normalized === "subagents") {
    return normalized;
  }
  if (normalized.startsWith("subagent:")) {
    const token = normalizeAllowlistSubagentToken(normalized.slice("subagent:".length));
    return token ? `subagent:${token}` : undefined;
  }
  return undefined;
}

function canonicalizeAllowlistEntry(rule: string, scope: AllowlistScope): string | undefined {
  const trimmed = rule.trim();
  if (!trimmed) {
    return undefined;
  }

  let canonicalRule = trimmed;
  if (trimmed === "*") {
    canonicalRule = "tool:*";
  } else if (trimmed.startsWith("tool:")) {
    canonicalRule = `tool:${trimmed.slice(5).trim() || "*"}`;
  } else if (trimmed.startsWith("prompt:")) {
    canonicalRule = `prompt:${trimmed.slice(7).trim() || "*"}`;
  } else if (trimmed.startsWith("resource:")) {
    canonicalRule = `resource:${trimmed.slice(9).trim() || "*"}`;
  }

  if (scope === "all") {
    return canonicalRule;
  }
  return `@${scope}|${canonicalRule}`;
}

function formatAllowlistEntry(entry: string): string {
  const parsed = parseScopedAllowlistEntry(entry);
  if (!parsed) {
    return entry.trim();
  }
  const formattedRule = formatAllowlistRule(parsed.rule);
  return parsed.scope === "all" ? formattedRule : `${formattedRule} [${parsed.scope}]`;
}

function parseServerToolReference(value: string): { serverName: string; toolName: string } | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const slashIndex = normalized.indexOf("/");
  if (slashIndex > 0 && slashIndex < normalized.length - 1) {
    return {
      serverName: normalized.slice(0, slashIndex).trim(),
      toolName: normalized.slice(slashIndex + 1).trim(),
    };
  }
  const segments = normalized.split(/\s+/).filter(Boolean);
  if (segments.length === 2) {
    return {
      serverName: segments[0],
      toolName: segments[1],
    };
  }
  return undefined;
}

function parseKeyValueArgs(rawValue: string): Record<string, string> {
  const matches = rawValue.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const entries = matches
    .map((token) => {
      const separatorIndex = token.indexOf("=");
      if (separatorIndex <= 0) {
        return undefined;
      }
      const key = token.slice(0, separatorIndex).trim();
      const value = token.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      return key ? [key, value] : undefined;
    })
    .filter((entry): entry is [string, string] => Boolean(entry));
  return Object.fromEntries(entries);
}

function normalizeStringMap(rawValue: Record<string, unknown> | undefined): Record<string, string> {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawValue)
      .map(([key, value]) => [String(key).trim(), typeof value === "string" ? value.trim() : String(value ?? "").trim()])
      .filter(([key, value]) => Boolean(key) && value.length > 0),
  );
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function unwrapQuotedArg(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isAbortErrorLike(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.toLowerCase().includes("cancelled");
  }
  const raw = String(error ?? "").toLowerCase();
  return raw.includes("abort") || raw.includes("cancelled");
}

function renderChatHistoryHtml(messages: ChatMessageData[]): string {
  const rows = messages
    .map((message) => {
      const toolCalls = (message.toolCalls ?? [])
        .map((toolCall) => {
          const result = toolCall.result
            ? `<div class="tool-result">${escapeHtml(summarizeToolResult(toolCall.result))}</div>`
            : "";
          return `
            <div class="tool-call">
              <div class="tool-title">${escapeHtml(formatToolCallLabel(toolCall))}</div>
              <div class="tool-meta">Status: ${escapeHtml(toolCall.status)}</div>
              <pre>${escapeHtml(JSON.stringify(toolCall.parameters, null, 2))}</pre>
              ${result}
            </div>
          `;
        })
        .join("");

      return `
        <section class="message ${message.role}">
          <div class="role">${escapeHtml(message.role === "user" ? "You" : "Assistant")}</div>
          <div class="content">${escapeHtml(message.text)}</div>
          ${toolCalls ? `<div class="tool-list">${toolCalls}</div>` : ""}
        </section>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OCI AI Chat Session</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #111827; color: #e5e7eb; }
      main { max-width: 960px; margin: 0 auto; padding: 32px 20px 40px; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      .meta { color: #9ca3af; font-size: 13px; margin-bottom: 24px; }
      .message { border: 1px solid #374151; border-radius: 12px; padding: 16px; margin-bottom: 14px; background: #1f2937; }
      .message.user { background: #172554; }
      .role { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #93c5fd; margin-bottom: 10px; }
      .content { white-space: pre-wrap; line-height: 1.6; }
      .tool-list { margin-top: 12px; display: grid; gap: 10px; }
      .tool-call { border: 1px solid #4b5563; border-radius: 10px; padding: 12px; background: rgba(15, 23, 42, 0.5); }
      .tool-title { font-weight: 600; margin-bottom: 6px; }
      .tool-meta { font-size: 12px; color: #cbd5e1; margin-bottom: 6px; }
      .tool-result { white-space: pre-wrap; margin-top: 8px; color: #d1fae5; }
      pre { margin: 0; white-space: pre-wrap; font-size: 12px; color: #cbd5e1; }
    </style>
  </head>
  <body>
    <main>
      <h1>OCI AI Chat Session</h1>
      <div class="meta">Exported at ${escapeHtml(new Date().toISOString())}</div>
      ${rows || "<p>No messages in this session.</p>"}
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeObjectStoragePrefix(value: unknown): string {
  const prefix = String(value ?? "").trim().replace(/^\/+/, "");
  if (!prefix) {
    return "";
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
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

function dedupeModelNames(models: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

function buildSqlAssistantPrompt(input: {
  mode: "generate" | "optimize";
  prompt: string;
  currentSql: string;
  schemaContext: string;
  connectionType?: SqlWorkbenchConnectionType;
  targetName?: string;
}): string {
  const scopeLabel = input.connectionType === "dbSystem" ? "Oracle Base Database Service" : "Autonomous Database";
  const targetDetails = input.targetName ? `${scopeLabel} target: ${input.targetName}` : `Connection type: ${scopeLabel}`;
  const modeInstructions = input.mode === "optimize"
    ? [
      "Optimize the provided Oracle SQL for clarity and performance.",
      "Keep the result semantically equivalent unless you must call out a risky assumption.",
      "Explain the main bottlenecks and tradeoffs briefly.",
    ]
    : [
      "Convert the user's request into Oracle SQL.",
      "Prefer a single statement unless the task clearly requires more.",
      "If the schema is incomplete, state assumptions briefly before the SQL.",
    ];

  const sections = [
    "You are an Oracle SQL copilot for VS Code.",
    ...modeInstructions,
    targetDetails,
    "Respond with three sections in this order:",
    "1. Assumptions",
    "2. SQL in a single ```sql fenced block```",
    "3. Notes",
    `User request: ${input.prompt || "(none provided)"}`,
  ];

  if (input.currentSql) {
    sections.push(`Current SQL:\n${input.currentSql}`);
  }
  if (input.schemaContext) {
    sections.push(`Schema context:\n${input.schemaContext}`);
  }
  return sections.join("\n\n");
}

function extractFirstSqlBlock(content: string): string | undefined {
  const match = content.match(/```sql\s*([\s\S]*?)```/i);
  const sql = match?.[1]?.trim();
  return sql || undefined;
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

function normalizeAllowlistSubagentToken(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseScopedAllowlistEntry(entry: string): { scope: AllowlistScope; rule: string } | undefined {
  const normalized = entry.trim();
  if (!normalized) {
    return undefined;
  }
  if (!normalized.startsWith("@")) {
    return {
      scope: "all",
      rule: normalized,
    };
  }

  const separatorIndex = normalized.indexOf("|");
  if (separatorIndex <= 1 || separatorIndex >= normalized.length - 1) {
    return undefined;
  }

  const scope = normalizeAllowlistScope(normalized.slice(1, separatorIndex));
  if (!scope) {
    return undefined;
  }
  const rule = normalized.slice(separatorIndex + 1).trim();
  return rule
    ? {
        scope,
        rule,
      }
    : undefined;
}

function formatAllowlistRule(rule: string): string {
  const normalized = rule.trim();
  if (!normalized || normalized === "*") {
    return "tool:*";
  }
  if (normalized.startsWith("tool:")) {
    return `tool:${normalized.slice(5).trim() || "*"}`;
  }
  if (normalized.startsWith("prompt:")) {
    return `prompt:${normalized.slice(7).trim() || "*"}`;
  }
  if (normalized.startsWith("resource:")) {
    return `resource:${normalized.slice(9).trim() || "*"}`;
  }
  return `tool:${normalized}`;
}
