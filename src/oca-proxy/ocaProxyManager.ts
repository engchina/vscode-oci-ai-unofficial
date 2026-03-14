import * as vscode from "vscode";
import { OcaTokenManager, OCA_CONFIG, startOAuthFlow } from "./ocaAuth";
import { OcaProxyServer, generateApiKey } from "./ocaProxyServer";

const API_KEY_SECRET_KEY = "ociAi.ocaProxy.apiKey";
const CONFIG_PREFIX = "ociAi";

export interface OcaProxyStatus {
  isAuthenticated: boolean;
  proxyRunning: boolean;
  proxyPort: number;
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
  private subscribers: Array<() => void> = [];

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.tokenManager = new OcaTokenManager(context.secrets);
  }

  async initialize(): Promise<void> {
    await this.tokenManager.load();
    this.cachedApiKey = (await this.secrets.get(API_KEY_SECRET_KEY)) ?? null;

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
    const port = this.getProxyPort();

    // If proxy is running on the same port we need for the OAuth callback,
    // temporarily stop it, run auth, then restart it.
    const wasRunning = this.isProxyRunning();
    if (wasRunning) {
      await this.proxyServer!.stop();
      this.proxyServer = null;
    }

    let refreshToken: string;
    try {
      refreshToken = await startOAuthFlow(port);
    } catch (err) {
      // Restart proxy if we stopped it, then re-throw
      if (wasRunning) {
        try { await this.startProxyInternal(); } catch { /* best effort */ }
      }
      throw err;
    }

    await this.tokenManager.setRefreshToken(refreshToken);

    // Restart proxy if it was running before auth
    if (wasRunning) {
      try { await this.startProxyInternal(); } catch { /* best effort */ }
    }

    this.broadcast();
  }

  async logout(): Promise<void> {
    await this.stopProxy();
    await this.tokenManager.clearAuth();
    this.broadcast();
  }

  isAuthenticated(): boolean {
    return this.tokenManager.isAuthenticated();
  }

  // --- Models ---

  async fetchModels(): Promise<string[]> {
    const token = await this.tokenManager.getToken();
    const res = await fetch(`${OCA_CONFIG.base_url}/v1/model/info`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch OCA models: HTTP ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (!Array.isArray(data.data)) return [];

    return (data.data as Array<Record<string, unknown>>)
      .map((item) => {
        const litellm = item.litellm_params as Record<string, unknown> | undefined;
        return (litellm?.model ?? item.model_name ?? "") as string;
      })
      .filter(Boolean);
  }

  // --- Config ---

  getProxyPort(): number {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<number>("ocaProxy.port", 8669);
  }

  getModel(): string {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<string>("ocaProxy.model", "oca/gpt-5.4");
  }

  getReasoningEffort(): string {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<string>("ocaProxy.reasoningEffort", "none");
  }

  isProxyEnabled(): boolean {
    return vscode.workspace.getConfiguration(CONFIG_PREFIX).get<boolean>("ocaProxy.enabled", false);
  }

  async saveConfig(cfg: OcaProxySaveConfig): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    await config.update("ocaProxy.port", cfg.proxyPort, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.model", cfg.model, vscode.ConfigurationTarget.Global);
    await config.update("ocaProxy.reasoningEffort", cfg.reasoningEffort, vscode.ConfigurationTarget.Global);
    // Model and reasoning effort are read dynamically per-request — no restart needed.
    // Port changes take effect on the next proxy start.
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
    return newKey;
  }

  // --- Proxy Lifecycle ---

  async startProxy(): Promise<void> {
    if (this.proxyServer?.isRunning()) return;
    await this.startProxyInternal();
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    await config.update("ocaProxy.enabled", true, vscode.ConfigurationTarget.Global);
    this.broadcast();
  }

  private async startProxyInternal(): Promise<void> {
    const apiKey = await this.getOrCreateApiKey();
    const port = this.getProxyPort();
    const server = new OcaProxyServer(
      port,
      apiKey,
      () => this.tokenManager.getToken(),
      () => ({ model: this.getModel(), reasoningEffort: this.getReasoningEffort() })
    );
    await server.start();
    this.proxyServer = server;
  }

  async stopProxy(): Promise<void> {
    if (this.proxyServer) {
      await this.proxyServer.stop();
      this.proxyServer = null;
    }
    const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
    await config.update("ocaProxy.enabled", false, vscode.ConfigurationTarget.Global);
    this.broadcast();
  }

  isProxyRunning(): boolean {
    return this.proxyServer?.isRunning() ?? false;
  }

  // --- Status ---

  async getStatus(): Promise<OcaProxyStatus> {
    const apiKey = await this.getOrCreateApiKey();
    return {
      isAuthenticated: this.isAuthenticated(),
      proxyRunning: this.isProxyRunning(),
      proxyPort: this.getProxyPort(),
      model: this.getModel(),
      reasoningEffort: this.getReasoningEffort(),
      apiKey,
      availableModels: [],
      baseUrl: OCA_CONFIG.base_url,
    };
  }

  dispose(): void {
    if (this.proxyServer?.isRunning()) {
      void this.proxyServer.stop();
    }
  }
}
