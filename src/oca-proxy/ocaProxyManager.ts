import * as vscode from "vscode";
import { OcaTokenManager, OCA_CONFIG, createOcaHeaders, type OcaOAuthFlowHandle, startOAuthFlow } from "./ocaAuth";
import { OcaProxyServer, extractModels, generateApiKey } from "./ocaProxyServer";

const API_KEY_SECRET_KEY = "ociAi.ocaProxy.apiKey";
const CONFIG_PREFIX = "ociAi";
const FIXED_PROXY_PORT = 8669;
const DEFAULT_PROXY_PORT = FIXED_PROXY_PORT;
const DEFAULT_AUTH_CALLBACK_PORT = FIXED_PROXY_PORT;
const DEFAULT_MODEL = "oca/gpt-5.4";
const DEFAULT_REASONING_EFFORT = "medium";
const VALID_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const MAX_IMAGES_PER_MESSAGE = 10;

type OcaChatImage = {
  dataUrl: string;
  mimeType: string;
  name?: string;
};

type OcaChatMessage = {
  role: "user" | "model";
  text: string;
  images?: OcaChatImage[];
};

type OcaChatStreamOptions = {
  signal?: AbortSignal;
  modelNameOverride?: string;
  runtimeSystemPrompt?: string;
};

export interface OcaProxyStatus {
  isAuthenticated: boolean;
  authInProgress: boolean;
  authError: string | null;
  proxyRunning: boolean;
  proxyPort: number;
  authCallbackPort: number;
  localBaseUrl: string;
  model: string;
  reasoningEffort: string;
  exposeToAssistant: boolean;
  apiKey: string;
  availableModels: string[];
  baseUrl: string;
}

export interface OcaProxySaveConfig {
  model: string;
  reasoningEffort: string;
  proxyPort: number;
  exposeToAssistant: boolean;
}

export class OcaProxyManager {
  private tokenManager: OcaTokenManager;
  private proxyServer: OcaProxyServer | null = null;
  private secrets: vscode.SecretStorage;
  private cachedApiKey: string | null = null;
  private availableModels: string[] = [];
  private modelsPromise: Promise<string[]> | null = null;
  private authFlowPromise: Promise<void> | null = null;
  private authFlowHandle: OcaOAuthFlowHandle | null = null;
  private authInvalidationPromise: Promise<void> | null = null;
  private proxyTransition: Promise<void> = Promise.resolve();
  private authInProgress = false;
  private lastAuthError: string | null = null;
  private authAttemptId = 0;
  private subscribers: Array<() => void> = [];

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.tokenManager = new OcaTokenManager(context.secrets);
  }

  async initialize(): Promise<void> {
    await this.tokenManager.load();
    this.cachedApiKey = (await this.secrets.get(API_KEY_SECRET_KEY)) ?? null;
    await this.ensureFixedProxyPortConfig();

    if (this.tokenManager.isAuthenticated()) {
      void this.refreshModels().catch(() => undefined);
    }

    // Auto-start proxy if it was previously enabled and user is authenticated
    if (this.tokenManager.isAuthenticated() && this.isProxyEnabled()) {
      try {
        await this.startProxy();
      } catch {
        // Silently ignore startup errors; user can start manually from UI
      }
    }
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(callback: () => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== callback);
    };
  }

  private broadcast(): void {
    for (const sub of this.subscribers) {
      try { sub(); } catch { /* ignore */ }
    }
  }

  // --- Auth ---

  async startAuth(): Promise<void> {
    if (this.authInProgress || this.authFlowPromise) {
      return;
    }

    const proxyPort = this.getProxyPort();
    const callbackPort = this.getAuthCallbackPort();
    const authAttemptId = ++this.authAttemptId;

    // Only pause the proxy when it would actually collide with the OAuth callback listener.
    const wasRunning =
      proxyPort === callbackPort
        ? await this.runProxyTransition(async () => this.stopProxyServerInternal())
        : false;

    this.authInProgress = true;
    this.lastAuthError = null;
    this.broadcast();

    let flow: OcaOAuthFlowHandle;
    try {
      flow = await startOAuthFlow(callbackPort);
    } catch (err) {
      this.authInProgress = false;
      this.lastAuthError = err instanceof Error ? err.message : String(err);
      await this.restoreProxyAfterAuthAttempt(wasRunning);
      this.broadcast();
      throw err;
    }
    this.authFlowHandle = flow;

    this.authFlowPromise = (async () => {
      try {
        const refreshToken = await flow.completion;
        if (authAttemptId !== this.authAttemptId) {
          return;
        }

        await this.tokenManager.setRefreshToken(refreshToken);
        this.lastAuthError = null;
        try {
          await this.refreshModels({ force: true });
        } catch {
          // Model refresh is best-effort and should not fail sign-in.
        }

        await this.restoreProxyAfterAuthAttempt(wasRunning);
      } catch (err) {
        if (authAttemptId !== this.authAttemptId) {
          return;
        }
        this.lastAuthError = err instanceof Error ? err.message : String(err);
        await this.restoreProxyAfterAuthAttempt(wasRunning);
      } finally {
        if (authAttemptId === this.authAttemptId) {
          this.authInProgress = false;
          this.broadcast();
        }
        if (this.authFlowHandle === flow) {
          this.authFlowHandle = null;
        }
        this.authFlowPromise = null;
      }
    })();

    void this.authFlowPromise.catch((err) => {
      console.error(`[OCA Proxy] OAuth flow failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  async logout(): Promise<void> {
    this.authAttemptId += 1;
    this.authInProgress = false;
    this.lastAuthError = null;
    this.availableModels = [];
    this.cancelOngoingAuthFlow();
    await this.stopProxy();
    await this.tokenManager.clearAuth();
    this.broadcast();
  }

  isAuthenticated(): boolean {
    return this.tokenManager.isAuthenticated();
  }

  // --- Models ---

  async fetchModels(): Promise<string[]> {
    if (this.authInProgress) {
      throw new Error("Complete Oracle Code Assist sign-in before refreshing models.");
    }
    return this.refreshModels({ force: true });
  }

  // --- Config ---

  getProxyPort(): number {
    return FIXED_PROXY_PORT;
  }

  getAuthCallbackPort(): number {
    return DEFAULT_AUTH_CALLBACK_PORT;
  }

  getModel(): string {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<string>("ocaProxy.model", DEFAULT_MODEL);
  }

  getReasoningEffort(): string {
    const configured = vscode.workspace
      .getConfiguration(CONFIG_PREFIX)
      .get<string>("ocaProxy.reasoningEffort", DEFAULT_REASONING_EFFORT);
    return normalizeReasoningEffort(configured);
  }

  shouldExposeToAssistant(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<boolean>("ocaProxy.exposeToAssistant", false);
  }

  isProxyEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<boolean>("ocaProxy.enabled", false);
  }

  getAssistantModels(): string[] {
    if (!this.shouldExposeToAssistant() || !this.isAuthenticated()) {
      return [];
    }
    const model = this.getModel().trim();
    return model ? [model] : [];
  }

  isConfiguredAssistantModel(modelName: string | undefined): boolean {
    const selectedModel = modelName?.trim();
    const configuredModel = this.getModel().trim();
    return matchesConfiguredModel(selectedModel, configuredModel);
  }

  handlesAssistantModel(modelName: string | undefined): boolean {
    return (
      this.isConfiguredAssistantModel(modelName) &&
      this.shouldExposeToAssistant() &&
      this.isAuthenticated() &&
      !this.authInProgress
    );
  }

  getUnavailableAssistantModelReason(modelName: string | undefined): string | undefined {
    if (!this.isConfiguredAssistantModel(modelName)) {
      return undefined;
    }
    if (!this.shouldExposeToAssistant()) {
      return "The selected OCA assistant model is hidden. Enable 'Show this model in Assistant' in OCA Proxy settings or choose another model.";
    }
    if (this.authInProgress) {
      return "Complete Oracle Code Assist sign-in before using the selected OCA assistant model.";
    }
    if (!this.isAuthenticated()) {
      return "Sign in to Oracle Code Assist before using the selected OCA assistant model.";
    }
    return undefined;
  }

  async saveConfig(cfg: OcaProxySaveConfig): Promise<void> {
    const proxyPort = normalizeProxyPort(cfg.proxyPort);
    const model = normalizeModel(cfg.model);
    const reasoningEffort = normalizeReasoningEffort(cfg.reasoningEffort);
    const exposeToAssistant = Boolean(cfg.exposeToAssistant);
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    await config.update("ocaProxy.port", proxyPort, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.model", model, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.reasoningEffort", reasoningEffort, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.exposeToAssistant", exposeToAssistant, vscode.ConfigurationTarget.Global);
    // Model and reasoning effort are read dynamically per-request — no restart needed.
    // Proxy port is fixed for compatibility with host access in remote environments.
    this.broadcast();
  }

  async chatStream(
    messages: OcaChatMessage[],
    onToken: (token: string) => void,
    options: OcaChatStreamOptions = {}
  ): Promise<void> {
    const { signal, modelNameOverride, runtimeSystemPrompt } = options;
    if (signal?.aborted) {
      throw createAbortError();
    }
    if (this.authInProgress) {
      throw new Error("Complete Oracle Code Assist sign-in before using the OCA assistant model.");
    }
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to Oracle Code Assist before using the OCA assistant model.");
    }

    const configuredModel = this.getModel().trim();
    if (!matchesConfiguredModel(modelNameOverride, configuredModel) || !this.shouldExposeToAssistant()) {
      throw new Error("The selected assistant model is not available from OCA Proxy.");
    }

    const cfg = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    const configuredSystemPrompt = cfg.get<string>("systemPrompt", "").trim();
    const systemPrompt = [configuredSystemPrompt, runtimeSystemPrompt?.trim()]
      .filter((section) => section && section.length > 0)
      .join("\n\n");
    const requestBody = buildOcaChatRequestBody(configuredModel, this.getReasoningEffort(), messages, systemPrompt);

    const token = await this.getProxyAccessToken();
    const streamRes = await fetch(`${OCA_CONFIG.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        ...createOcaHeaders(token),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!streamRes.ok) {
      throw new Error(await resolveOcaErrorMessage(streamRes));
    }

    if (streamRes.body) {
      const emittedCount = await readStream(streamRes.body, onToken, signal);
      if (emittedCount > 0) {
        return;
      }
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    const nonStreamRes = await fetch(`${OCA_CONFIG.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        ...createOcaHeaders(token),
        Accept: "application/json",
      },
      body: JSON.stringify({ ...requestBody, stream: false }),
      signal,
    });

    if (!nonStreamRes.ok) {
      throw new Error(await resolveOcaErrorMessage(nonStreamRes));
    }

    const responseText = extractOcaChatText(await nonStreamRes.json());
    if (responseText) {
      onToken(responseText);
      return;
    }

    onToken("Oracle Code Assist returned an empty response.");
  }

  async getOrCreateApiKey(): Promise<string> {
    if (this.cachedApiKey) return this.cachedApiKey;
    const stored = await this.secrets.get(API_KEY_SECRET_KEY);
    if (stored) {
      this.cachedApiKey = stored;
      return stored;
    }
    return this.generateNewApiKey();
  }

  async generateNewApiKey(): Promise<string> {
    const newKey = generateApiKey();
    this.cachedApiKey = newKey;
    await this.secrets.store(API_KEY_SECRET_KEY, newKey);
    if (this.proxyServer) {
      this.proxyServer.updateApiKey(newKey);
    }
    this.broadcast();
    return newKey;
  }

  // --- Proxy Lifecycle ---

  async startProxy(): Promise<void> {
    await this.runProxyTransition(async () => {
      if (this.proxyServer?.isRunning()) return;
      if (this.authInProgress) {
        throw new Error("Complete Oracle Code Assist sign-in before starting the proxy.");
      }
      if (!this.isAuthenticated()) {
        throw new Error("Sign in to Oracle Code Assist before starting the proxy.");
      }
      await this.startProxyServerInternal();
      const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
      await config.update("ocaProxy.enabled", true, vscode.ConfigurationTarget.Global);
      this.broadcast();
    });
  }

  private async startProxyServerInternal(): Promise<void> {
    if (this.proxyServer?.isRunning()) {
      return;
    }
    const apiKey = await this.getOrCreateApiKey();
    const port = this.getProxyPort();
    const server = new OcaProxyServer(
      port,
      apiKey,
      () => this.getProxyAccessToken(),
      () => ({ model: this.getModel(), reasoningEffort: this.getReasoningEffort() })
    );
    await server.start();
    this.proxyServer = server;
  }

  async stopProxy(): Promise<void> {
    await this.runProxyTransition(async () => {
      await this.stopProxyServerInternal();
      const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
      await config.update("ocaProxy.enabled", false, vscode.ConfigurationTarget.Global);
      this.broadcast();
    });
  }

  isProxyRunning(): boolean {
    return this.proxyServer?.isRunning() ?? false;
  }

  // --- Status ---

  async getStatus(): Promise<OcaProxyStatus> {
    if (!this.isAuthenticated() && this.availableModels.length > 0) {
      this.availableModels = [];
    }
    if (this.isAuthenticated() && !this.authInProgress && this.availableModels.length === 0 && !this.modelsPromise) {
      void this.refreshModels().catch(() => undefined);
    }
    const proxyPort = this.getProxyPort();
    const localBaseUrl = `http://127.0.0.1:${proxyPort}`;
    const proxyRunning = this.isProxyRunning();
    const apiKey = await this.getOrCreateApiKey();
    const baseUrl = proxyRunning
      ? await this.resolveAccessibleProxyBaseUrl(localBaseUrl)
      : localBaseUrl;
    return {
      isAuthenticated: this.isAuthenticated(),
      authInProgress: this.authInProgress,
      authError: this.lastAuthError,
      proxyRunning,
      proxyPort,
      authCallbackPort: this.getAuthCallbackPort(),
      localBaseUrl,
      model: this.getModel(),
      reasoningEffort: this.getReasoningEffort(),
      exposeToAssistant: this.shouldExposeToAssistant(),
      apiKey,
      availableModels: [...this.availableModels],
      baseUrl,
    };
  }

  dispose(): void {
    this.cancelOngoingAuthFlow();
    void this.runProxyTransition(async () => {
      await this.stopProxyServerInternal();
    });
  }

  private async refreshModels(options?: { force?: boolean }): Promise<string[]> {
    if (!this.isAuthenticated()) {
      this.availableModels = [];
      return [];
    }

    if (!options?.force && this.availableModels.length > 0) {
      return [...this.availableModels];
    }

    if (this.modelsPromise) {
      return this.modelsPromise;
    }

    this.modelsPromise = (async () => {
      const token = await this.getProxyAccessToken();
      const res = await fetch(`${OCA_CONFIG.base_url}/v1/model/info`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch OCA models: HTTP ${res.status}`);
      }

      const models = dedupeModels(extractModels(await res.json()));
      this.availableModels = models;
      return [...models];
    })();

    try {
      return await this.modelsPromise;
    } finally {
      this.modelsPromise = null;
    }
  }

  private cancelOngoingAuthFlow(): void {
    if (!this.authFlowHandle) {
      return;
    }
    this.authFlowHandle.cancel();
    this.authFlowHandle = null;
  }

  private async restoreProxyAfterAuthAttempt(wasRunning: boolean): Promise<void> {
    if (!wasRunning || !this.isProxyEnabled()) {
      return;
    }
    try {
      await this.runProxyTransition(async () => {
        await this.startProxyServerInternal();
      });
    } catch {
      // best effort
    }
  }

  private async getProxyAccessToken(): Promise<string> {
    try {
      return await this.tokenManager.getToken();
    } catch (err) {
      if (!this.tokenManager.isAuthenticated()) {
        void this.handleAuthInvalidated(err);
      }
      throw err;
    }
  }

  private async handleAuthInvalidated(err: unknown): Promise<void> {
    if (this.authInvalidationPromise) {
      return this.authInvalidationPromise;
    }

    const message = err instanceof Error ? err.message : String(err);
    this.authInvalidationPromise = (async () => {
      this.lastAuthError = message;
      this.availableModels = [];
      await this.runProxyTransition(async () => {
        await this.stopProxyServerInternal();
        const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
        await config.update("ocaProxy.enabled", false, vscode.ConfigurationTarget.Global);
      });
      this.broadcast();
    })();

    try {
      await this.authInvalidationPromise;
    } finally {
      this.authInvalidationPromise = null;
    }
  }

  private async stopProxyServerInternal(): Promise<boolean> {
    if (!this.proxyServer) {
      return false;
    }
    const server = this.proxyServer;
    this.proxyServer = null;
    await server.stop();
    return true;
  }

  private async runProxyTransition<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.proxyTransition
      .catch(() => undefined)
      .then(operation);

    this.proxyTransition = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  private async resolveAccessibleProxyBaseUrl(fallbackBaseUrl: string): Promise<string> {
    try {
      const externalUri = await vscode.env.asExternalUri(vscode.Uri.parse(fallbackBaseUrl));
      return stripTrailingSlash(externalUri.toString());
    } catch {
      return fallbackBaseUrl;
    }
  }

  private async ensureFixedProxyPortConfig(): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    const configuredPort = config.get<number>("ocaProxy.port");
    if (configuredPort !== FIXED_PROXY_PORT) {
      await config.update("ocaProxy.port", FIXED_PROXY_PORT, vscode.ConfigurationTarget.Global);
    }
  }
}

function normalizeProxyPort(value: number): number {
  if (value !== FIXED_PROXY_PORT) {
    throw new Error(`Proxy port is fixed at ${FIXED_PROXY_PORT}.`);
  }
  return FIXED_PROXY_PORT;
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (!model) {
    throw new Error("A default OCA model is required.");
  }
  return model;
}

function normalizeReasoningEffort(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none") {
    return DEFAULT_REASONING_EFFORT;
  }
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error("Reasoning effort must be one of: low, medium, high, xhigh.");
  }
  return normalized;
}

function dedupeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const model of models) {
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    deduped.push(model);
  }
  return deduped;
}

function stripTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function matchesConfiguredModel(selectedModel: string | undefined, configuredModel: string): boolean {
  const selected = selectedModel?.trim();
  return !!selected && selected.toLowerCase() === configuredModel.trim().toLowerCase();
}

function buildOcaChatRequestBody(
  model: string,
  reasoningEffort: string,
  messages: OcaChatMessage[],
  systemPrompt: string,
): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    model,
    stream: true,
    messages: buildOcaChatMessages(messages, systemPrompt),
  };

  if (reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort;
  }

  return requestBody;
}

function buildOcaChatMessages(messages: OcaChatMessage[], systemPrompt: string): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const message of messages) {
    const role = message.role === "model" ? "assistant" : "user";
    const text = message.text.trim();
    const images = normalizeImages(message.images);
    if (!text && images.length === 0) {
      continue;
    }

    if (role === "user" && images.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (text) {
        content.push({ type: "text", text });
      }
      for (const image of images) {
        content.push({
          type: "image_url",
          image_url: { url: image.dataUrl },
        });
      }
      result.push({ role, content });
      continue;
    }

    result.push({ role, content: text || "" });
  }

  return result;
}

function normalizeImages(images: OcaChatImage[] | undefined): OcaChatImage[] {
  if (!Array.isArray(images)) {
    return [];
  }

  const normalized: OcaChatImage[] = [];
  for (const image of images) {
    if (!image || typeof image.dataUrl !== "string" || typeof image.mimeType !== "string") {
      continue;
    }
    const dataUrl = image.dataUrl.trim();
    if (!isImageDataUrl(dataUrl)) {
      continue;
    }
    normalized.push({
      dataUrl,
      mimeType: image.mimeType.trim(),
      name: typeof image.name === "string" ? image.name.trim() : undefined,
    });
    if (normalized.length >= MAX_IMAGES_PER_MESSAGE) {
      break;
    }
  }

  return normalized;
}

function isImageDataUrl(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }
  return /^data:image\//i.test(value);
}

function createAbortError(): Error {
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  return error;
}

async function resolveOcaErrorMessage(response: Response): Promise<string> {
  const fallback = `Oracle Code Assist returned HTTP ${response.status}.`;
  try {
    const text = (await response.text()).trim();
    if (!text) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(text) as Record<string, any>;
      const parsedMessage =
        parsed?.error?.message ??
        parsed?.message ??
        parsed?.detail;
      if (typeof parsedMessage === "string" && parsedMessage.trim()) {
        return parsedMessage.trim();
      }
    } catch {
      // Fall back to the raw response text.
    }
    return text;
  } catch {
    return fallback;
  }
}

function extractOcaChatText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const choices = (payload as Record<string, any>).choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const choice of choices) {
    if (typeof choice?.message?.content === "string" && choice.message.content.trim()) {
      parts.push(choice.message.content.trim());
      continue;
    }
    if (Array.isArray(choice?.message?.content)) {
      for (const item of choice.message.content) {
        if (typeof item?.text === "string" && item.text.trim()) {
          parts.push(item.text.trim());
        }
      }
      continue;
    }
    if (typeof choice?.text === "string" && choice.text.trim()) {
      parts.push(choice.text.trim());
    }
  }

  const joined = parts.join("").trim();
  return joined || undefined;
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<number> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  const reader = stream.getReader();
  const onAbort = () => {
    void reader.cancel();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const decoder = new TextDecoder();
  let buffer = "";
  let doneFromServer = false;
  let emittedCount = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const result = processSseLine(line, onToken);
        emittedCount += result.emittedCount;
        doneFromServer = result.done || doneFromServer;
        if (doneFromServer) {
          return emittedCount;
        }
      }
    }

    buffer += decoder.decode();
    if (buffer) {
      const lines = buffer.split("\n");
      for (const line of lines) {
        const result = processSseLine(line, onToken);
        emittedCount += result.emittedCount;
        doneFromServer = result.done || doneFromServer;
        if (doneFromServer) {
          return emittedCount;
        }
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  return emittedCount;
}

function processSseLine(
  line: string,
  onToken: (token: string) => void
): { done: boolean; emittedCount: number } {
  const normalized = line.trimEnd();
  if (!normalized.startsWith("data:")) {
    return { done: false, emittedCount: 0 };
  }

  const data = normalized.slice(5).trim();
  if (!data) {
    return { done: false, emittedCount: 0 };
  }
  if (data === "[DONE]") {
    return { done: true, emittedCount: 0 };
  }

  try {
    const chunk = JSON.parse(data);
    const token = sanitizeToken(extractChunkToken(chunk));
    if (token) {
      onToken(token);
      return { done: false, emittedCount: 1 };
    }
  } catch {
    // Ignore malformed chunks.
  }

  return { done: false, emittedCount: 0 };
}

function extractChunkToken(chunk: any): string {
  const choice = chunk?.choices?.[0];
  const fromChoices =
    choice?.delta?.content ??
    choice?.delta?.text ??
    choice?.text ??
    choice?.message?.content?.[0]?.text ??
    choice?.message?.content?.[0]?.message;
  if (typeof fromChoices === "string") {
    return fromChoices;
  }

  if (typeof chunk?.text === "string") {
    return chunk.text;
  }

  return "";
}

function sanitizeToken(token: string): string {
  return token
    .replace(/\\?u258b/gi, "")
    .replace(/▋/g, "")
    .replace(/\u258b/gi, "");
}
