import * as http from "http";
import * as crypto from "crypto";
import { OCA_CONFIG, createOcaHeaders } from "./ocaAuth";

export interface OcaProxyConfig {
  model: string;
  reasoningEffort: string;
}

export type GetTokenFn = () => Promise<string>;
export type GetConfigFn = () => OcaProxyConfig;

export class OcaProxyServer {
  private server: http.Server | null = null;
  private apiKey: string;
  private port: number;
  private getToken: GetTokenFn;
  private getConfig: GetConfigFn;

  constructor(
    port: number,
    apiKey: string,
    getToken: GetTokenFn,
    getConfig: GetConfigFn
  ) {
    this.port = port;
    this.apiKey = apiKey;
    this.getToken = getToken;
    this.getConfig = getConfig;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        resolve();
        return;
      }

      const server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      // Startup-only error handler — removed once listening begins
      const onStartupError = (err: Error) => {
        this.server = null;
        reject(new Error(`OCA proxy failed to start on port ${this.port}: ${err.message}`));
      };
      server.once("error", onStartupError);

      server.listen(this.port, "127.0.0.1", () => {
        // Switch to runtime error handler (logs only, does not crash)
        server.removeListener("error", onStartupError);
        server.on("error", (err) => {
          console.error(`[OCA Proxy] Runtime server error: ${err.message}`);
        });
        this.server = server;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      const s = this.server;
      this.server = null;
      s.close(() => resolve());
    });
  }

  updateApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  private validateApiKey(req: http.IncomingMessage): boolean {
    const authHeader = req.headers["authorization"];
    const apiKeyHeader = req.headers["x-api-key"];

    if (authHeader) {
      const parts = authHeader.split(" ");
      if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
        return parts[1] === this.apiKey;
      }
    }
    if (apiKeyHeader === this.apiKey) {
      return true;
    }
    return false;
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(200, corsHeaders());
      res.end();
      return;
    }

    // Health check — no auth required
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "oca-proxy" }));
      return;
    }

    // Validate API key
    if (!this.validateApiKey(req)) {
      res.writeHead(401, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key", type: "invalid_request_error" } }));
      return;
    }

    const url = req.url ?? "/";

    if (req.method === "GET" && url === "/v1/models") {
      await this.handleListModels(res);
      return;
    }

    if (req.method === "POST" && url === "/v1/chat/completions") {
      await this.handleChatCompletions(req, res);
      return;
    }

    res.writeHead(404, { ...corsHeaders(), "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request_error" } }));
  }

  private async handleListModels(res: http.ServerResponse): Promise<void> {
    try {
      const token = await this.getToken();
      const headers = createOcaHeaders(token);

      const ocaRes = await fetch(`${OCA_CONFIG.base_url}/v1/model/info`, { headers });

      if (!ocaRes.ok) {
        throw new Error(`OCA models API returned ${ocaRes.status}`);
      }

      const data = (await ocaRes.json()) as unknown;
      const models = extractModels(data);

      res.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: models.map((id) => ({
            id,
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "oca",
          })),
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message, type: "api_error" } }));
    }
  }

  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Failed to read request body", type: "invalid_request_error" } }));
      return;
    }

    let requestBody: Record<string, unknown>;
    try {
      requestBody = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
      return;
    }

    const config = this.getConfig();

    // Apply configured model only if client did not specify one
    if (!requestBody.model) {
      requestBody.model = config.model;
    }

    // Apply reasoning_effort from config only if not already set by client
    if (!requestBody.reasoning_effort && config.reasoningEffort && config.reasoningEffort !== "none") {
      requestBody.reasoning_effort = config.reasoningEffort;
    }

    const isStreaming = requestBody.stream === true;

    try {
      const token = await this.getToken();
      const headers = {
        ...createOcaHeaders(token),
        Accept: isStreaming ? "text/event-stream" : "application/json",
      };

      const ocaRes = await fetch(`${OCA_CONFIG.base_url}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!ocaRes.ok) {
        const errText = await ocaRes.text();
        res.writeHead(ocaRes.status, { ...corsHeaders(), "Content-Type": "application/json" });
        res.end(errText);
        return;
      }

      if (isStreaming) {
        res.writeHead(200, {
          ...corsHeaders(),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const reader = ocaRes.body?.getReader();
        if (!reader) {
          res.end();
          return;
        }

        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) res.write(decoder.decode(value, { stream: true }));
          }
        } finally {
          reader.releaseLock();
          res.end();
        }
      } else {
        const data = await ocaRes.text();
        res.writeHead(200, { ...corsHeaders(), "Content-Type": "application/json" });
        res.end(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { ...corsHeaders(), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message, type: "api_error" } }));
      } else {
        res.end();
      }
    }
  }
}

// --- Helpers ---

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function extractModels(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;

  // OCA returns { data: [ { model_name, litellm_params: { model } } ] }
  if (Array.isArray(d.data)) {
    return (d.data as Array<Record<string, unknown>>)
      .map((item) => {
        const litellm = item.litellm_params as Record<string, unknown> | undefined;
        return (litellm?.model ?? item.model_name ?? "") as string;
      })
      .filter(Boolean);
  }

  return [];
}

/** Generate a cryptographically random API key */
export function generateApiKey(): string {
  return `oca-${crypto.randomBytes(24).toString("base64url")}`;
}
