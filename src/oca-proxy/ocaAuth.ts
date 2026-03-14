import * as crypto from "crypto";
import * as http from "http";
import * as vscode from "vscode";

// --- OCA OAuth2 Configuration ---

export const OCA_CONFIG = {
  client_id: "a8331954c0cf48ba99b5dd223a14c6ea",
  idcs_url:
    "https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com",
  scopes: "openid offline_access",
  base_url:
    "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
};

const REFRESH_TOKEN_SECRET_KEY = "ociAi.ocaProxy.refreshToken";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

// --- OIDC discovery cache ---

let cachedDiscovery: { tokenEndpoint: string; authEndpoint: string } | null = null;

async function getOidcEndpoints(): Promise<{ tokenEndpoint: string; authEndpoint: string }> {
  if (cachedDiscovery) return cachedDiscovery;
  const data = await fetchJson(`${OCA_CONFIG.idcs_url}/.well-known/openid-configuration`);
  cachedDiscovery = {
    tokenEndpoint: data.token_endpoint as string,
    authEndpoint: data.authorization_endpoint as string,
  };
  return cachedDiscovery;
}

// --- PKCE Utilities ---

export function generateCodeVerifier(): string {
  return crypto.randomBytes(96).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function generateRandomString(length = 32): string {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

// --- Token Manager ---

export class OcaTokenManager {
  private refreshToken: string | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private refreshPromise: Promise<string> | null = null;
  private secrets: vscode.SecretStorage;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async load(): Promise<void> {
    const token = await this.secrets.get(REFRESH_TOKEN_SECRET_KEY);
    this.refreshToken = token ?? null;
  }

  isAuthenticated(): boolean {
    return this.refreshToken !== null;
  }

  async setRefreshToken(token: string): Promise<void> {
    this.refreshToken = token;
    this.accessToken = null;
    this.tokenExpiry = null;
    await this.secrets.store(REFRESH_TOKEN_SECRET_KEY, token);
  }

  async clearAuth(): Promise<void> {
    this.refreshToken = null;
    this.accessToken = null;
    this.tokenExpiry = null;
    await this.secrets.delete(REFRESH_TOKEN_SECRET_KEY);
  }

  async getToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error("Not authenticated with Oracle Code Assist.");
    }

    // Return cached token if still valid (5 min buffer)
    if (this.accessToken && this.tokenExpiry) {
      const timeUntilExpiry = (this.tokenExpiry.getTime() - Date.now()) / 1000;
      if (timeUntilExpiry > 300) {
        return this.accessToken;
      }
    }

    // Prevent concurrent refreshes
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefreshToken();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshToken(): Promise<string> {
    const { tokenEndpoint } = await getOidcEndpoints();

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken!,
      client_id: OCA_CONFIG.client_id,
    });

    const response = await fetchPost(tokenEndpoint, params.toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
    });

    if (response.error) {
      if (
        response.error === "invalid_grant" ||
        response.error === "invalid_token"
      ) {
        // Clear cached discovery so next login gets fresh endpoints
        cachedDiscovery = null;
        await this.clearAuth();
        throw new Error(
          "Oracle Code Assist session expired. Please sign in again."
        );
      }
      throw new Error(`Token refresh failed: ${String(response.error)}`);
    }

    this.accessToken = response.access_token as string;
    const expiresIn = (response.expires_in as number) || 3600;
    this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

    // Update refresh token if a new one was issued (tokens may be single-use)
    const newRefreshToken = response.refresh_token as string | undefined;
    if (newRefreshToken && newRefreshToken !== this.refreshToken) {
      this.refreshToken = newRefreshToken;
      await this.secrets.store(REFRESH_TOKEN_SECRET_KEY, newRefreshToken);
    }

    return this.accessToken;
  }
}

// --- OAuth Flow ---

export interface OcaOAuthFlowHandle {
  completion: Promise<string>;
  cancel: (reason?: string) => void;
}

/**
 * Start the OAuth2 PKCE flow:
 * 1. Start a temporary HTTP server on callbackPort to receive the redirect
 * 2. Open the browser to the OCA authorization URL
 * 3. Wait for the callback, exchange code for tokens
 * Returns once the callback server is listening and the browser launch has been attempted.
 * The returned handle's completion promise resolves with the refresh token once the flow finishes.
 */
export async function startOAuthFlow(callbackPort: number): Promise<OcaOAuthFlowHandle> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);
  const nonce = generateRandomString(32);
  const redirectUri = `http://localhost:${callbackPort}/callback`;

  const { authEndpoint, tokenEndpoint } = await getOidcEndpoints();

  const params = new URLSearchParams({
    client_id: OCA_CONFIG.client_id,
    response_type: "code",
    scope: OCA_CONFIG.scopes,
    redirect_uri: redirectUri,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${authEndpoint}?${params.toString()}`;

  return new Promise<OcaOAuthFlowHandle>((resolveLaunch, rejectLaunch) => {
    let completionSettled = false;
    let launchResolved = false;

    let resolveCompletion: (value: string) => void = () => { };
    let rejectCompletion: (reason?: unknown) => void = () => { };
    const completion = new Promise<string>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    const settleCompletion = (fn: () => void) => {
      if (completionSettled) {
        return;
      }
      completionSettled = true;
      clearTimeout(timeout);
      fn();
    };

    const failLaunch = (error: Error) => {
      clearTimeout(timeout);
      if (!completionSettled) {
        completionSettled = true;
        void completion.catch(() => undefined);
        rejectCompletion(error);
      }
      rejectLaunch(error);
    };

    const cancelFlow = (reason = "Oracle Code Assist sign-in cancelled.") => {
      const error = new Error(reason);
      if (server.listening) {
        server.close();
      }
      if (launchResolved) {
        settleCompletion(() => rejectCompletion(error));
      } else {
        failLaunch(error);
      }
    };

    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const url = new URL(req.url, `http://localhost:${callbackPort}`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        const error = new Error(`OAuth error: ${errorParam}`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildCallbackHtml(false, `Authentication error: ${escapeHtml(errorParam)}`));
        server.close();
        settleCompletion(() => rejectCompletion(error));
        return;
      }

      if (!code || returnedState !== state) {
        const error = new Error("Invalid OAuth callback: missing code or state mismatch");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildCallbackHtml(false, "Invalid callback parameters."));
        server.close();
        settleCompletion(() => rejectCompletion(error));
        return;
      }

      try {
        const tokenParams = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: OCA_CONFIG.client_id,
          code_verifier: codeVerifier,
        });

        const tokenResponse = await fetchPost(
          tokenEndpoint,
          tokenParams.toString(),
          { "Content-Type": "application/x-www-form-urlencoded" }
        );

        if (tokenResponse.error) {
          throw new Error(`Token exchange failed: ${String(tokenResponse.error)}`);
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildCallbackHtml(true, "Signed in to Oracle Code Assist successfully. You may close this tab."));
        server.close();
        settleCompletion(() => resolveCompletion(tokenResponse.refresh_token as string));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildCallbackHtml(false, escapeHtml(msg)));
        server.close();
        settleCompletion(() => rejectCompletion(err instanceof Error ? err : new Error(msg)));
      }
    });

    const timeout = setTimeout(() => {
      const error = new Error("OAuth timeout: no callback received within 5 minutes");
      server.close();
      if (launchResolved) {
        settleCompletion(() => rejectCompletion(error));
      } else {
        failLaunch(error);
      }
    }, OAUTH_TIMEOUT_MS);

    server.once("error", (err) => {
      const error = new Error(`Failed to start OAuth callback server on port ${callbackPort}: ${err.message}`);
      if (launchResolved) {
        settleCompletion(() => rejectCompletion(error));
      } else {
        failLaunch(error);
      }
    });

    server.listen(callbackPort, "127.0.0.1", () => {
      vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
        () => {
          launchResolved = true;
          resolveLaunch({ completion, cancel: cancelFlow });
        },
        (err: unknown) => {
          const error = new Error(`Failed to open browser: ${String(err)}`);
          server.close();
          failLaunch(error);
        }
      );
    });
  });
}

// --- Create OCA Request Headers ---

export function createOcaHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "opc-request-id": crypto.randomUUID(),
    "Content-Type": "application/json",
  };
}

// --- Fetch Helpers (Node built-in fetch, available since Node 18) ---

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchPost(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers, body });
  return res.json() as Promise<Record<string, unknown>>;
}

// --- Helpers ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildCallbackHtml(success: boolean, message: string): string {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "✓" : "✗";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Oracle Code Assist</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #1e1e2e; color: #cdd6f4; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #313244; border-radius: 12px; padding: 2rem 3rem; text-align: center; max-width: 420px; }
    .icon { font-size: 2.5rem; color: ${color}; }
    h1 { font-size: 1.25rem; margin: 0.5rem 0; }
    p { color: #a6adc8; font-size: 0.9rem; margin: 0.5rem 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>Oracle Code Assist</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
