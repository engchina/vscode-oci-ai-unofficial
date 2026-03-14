import * as vscode from "vscode";
import { OcaTokenManager, OCA_CONFIG, type OcaOAuthFlowHandle, startOAuthFlow } from "./ocaAuth";
import { OcaProxyServer, extractModels, generateApiKey } from "./ocaProxyServer";

const API_KEY_SECRET_KEY = "ociAi.ocaProxy.apiKey";
const CONFIG_PREFIX = "ociAi";
const FIXED_PROXY_PORT = 8669;
const DEFAULT_PROXY_PORT = FIXED_PROXY_PORT;
const DEFAULT_AUTH_CALLBACK_PORT = FIXED_PROXY_PORT;
const DEFAULT_MODEL = "oca/gpt-5.4";
const DEFAULT_REASONING_EFFORT = "none";
const VALID_REASONING_EFFORTS = new Set(["none", "low", "medium", "high"]);

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
  apiKey: string;
  availableModels: string[];
  baseUrl: string;
}

export interface OcaProxySaveConfig {
  model: string;
  reasoningEffort: string;
  proxyPort: number;
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
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<string>("ocaProxy.reasoningEffort", DEFAULT_REASONING_EFFORT);
  }

  isProxyEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<boolean>("ocaProxy.enabled", false);
  }

  async saveConfig(cfg: OcaProxySaveConfig): Promise<void> {
    const proxyPort = normalizeProxyPort(cfg.proxyPort);
    const model = normalizeModel(cfg.model);
    const reasoningEffort = normalizeReasoningEffort(cfg.reasoningEffort);
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    await config.update("ocaProxy.port", proxyPort, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.model", model, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.reasoningEffort", reasoningEffort, vscode.ConfigurationTarget.Global);
    // Model and reasoning effort are read dynamically per-request — no restart needed.
    // Proxy port is fixed for compatibility with host access in remote environments.
    this.broadcast();
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
  if (!VALID_REASONING_EFFORTS.has(normalized)) {
    throw new Error("Reasoning effort must be one of: none, low, medium, high.");
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
