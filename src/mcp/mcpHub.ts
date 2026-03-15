import * as vscode from "vscode";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type {
  AddMcpServerRequest,
  McpSmokeTestResult,
  McpPromptInfo,
  McpResourceInfo,
  McpServerConfig,
  McpServerState,
  McpToolInfo,
  ToolCallContent,
  ToolCallResult,
  UpdateMcpServerRequest,
} from "../shared/mcp-types";

const MCP_SERVERS_CONFIG_KEY = "ociAi.mcpServers";
const DEFAULT_MCP_TIMEOUT_SECONDS = 30;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000;

type McpTransport =
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport;

type McpConnection = {
  client: Client;
  transport: McpTransport;
};

export type McpPromptResult = {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: ToolCallContent[];
  }>;
};

export type McpAllowlistContext = {
  requester: "main" | "subagent";
  subagentId?: string;
};

export type McpAllowlistAction =
  | {
      kind: "tool";
      name: string;
    }
  | {
      kind: "prompt";
      name: string;
    }
  | {
      kind: "resource";
      uri: string;
    };

/**
 * McpHub manages MCP server lifecycle, capability discovery, and live tool execution.
 */
export class McpHub {
  private servers: Map<string, McpServerState> = new Map();
  private connections: Map<string, McpConnection> = new Map();
  private connectionAttemptIds: Map<string, number> = new Map();
  private disposables: vscode.Disposable[] = [];
  private onDidChangeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor() {
    this.loadFromConfig();

    const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(MCP_SERVERS_CONFIG_KEY)) {
        this.loadFromConfig();
      }
    });
    this.disposables.push(configWatcher);
  }

  public getServers(): McpServerState[] {
    return Array.from(this.servers.values());
  }

  public getServer(name: string): McpServerState | undefined {
    return this.servers.get(name);
  }

  public getConnectedServers(): McpServerState[] {
    return this.getServers().filter((server) => server.status === "connected" && !server.config.disabled);
  }

  public getConnectedTools(): Array<{ serverName: string; tool: McpToolInfo }> {
    return this.getConnectedServers().flatMap((server) =>
      server.tools.map((tool) => ({ serverName: server.name, tool })),
    );
  }

  public isToolAutoApproved(serverName: string, toolName: string): boolean {
    return this.isActionAutoApproved(
      serverName,
      { kind: "tool", name: toolName },
      { requester: "main" },
    );
  }

  public getAllowlistEntries(serverName: string): string[] {
    const server = this.servers.get(serverName);
    return [...(server?.config.autoApprove ?? [])];
  }

  public isActionAutoApproved(
    serverName: string,
    action: McpAllowlistAction,
    context: McpAllowlistContext,
  ): boolean {
    const server = this.servers.get(serverName);
    if (!server) {
      return false;
    }

    return (server.config.autoApprove ?? []).some((entry) => {
      const parsed = parseAllowlistEntry(entry);
      if (!parsed || !matchesAllowlistScope(parsed.scope, context)) {
        return false;
      }
      switch (action.kind) {
        case "tool":
          return parsed.kind === "tool" && (parsed.matcher === "*" || parsed.matcher === action.name);
        case "prompt":
          return parsed.kind === "prompt" && (parsed.matcher === "*" || parsed.matcher === action.name);
        case "resource":
          return parsed.kind === "resource" && (parsed.matcher === "*" || action.uri.startsWith(parsed.matcher));
        default:
          return false;
      }
    });
  }

  public async addServer(request: AddMcpServerRequest): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    if (existing[request.name]) {
      throw new Error(`MCP server "${request.name}" already exists.`);
    }
    const updated = { ...existing, [request.name]: request.config };
    await cfg.update("mcpServers", updated, vscode.ConfigurationTarget.Global);
  }

  public async updateServer(request: UpdateMcpServerRequest): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    const current = existing[request.currentName];
    if (!current) {
      throw new Error(`MCP server "${request.currentName}" was not found.`);
    }
    if (request.currentName !== request.name && existing[request.name]) {
      throw new Error(`MCP server "${request.name}" already exists.`);
    }

    const updated = { ...existing };
    delete updated[request.currentName];
    updated[request.name] = request.config;
    await cfg.update("mcpServers", updated, vscode.ConfigurationTarget.Global);
  }

  public async removeServer(name: string): Promise<void> {
    await this.disconnectServer(name);
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    const updated = { ...existing };
    delete updated[name];
    await cfg.update("mcpServers", updated, vscode.ConfigurationTarget.Global);
  }

  public async toggleServer(name: string, enabled: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    const current = existing[name];
    if (!current) {
      return;
    }

    const updated = {
      ...existing,
      [name]: {
        ...current,
        disabled: !enabled,
      },
    };
    await cfg.update("mcpServers", updated, vscode.ConfigurationTarget.Global);
  }

  public async restartServer(name: string): Promise<void> {
    await this.disconnectServer(name);
    const server = this.servers.get(name);
    if (server && !server.config.disabled) {
      await this.connectServer(name);
    } else {
      this.onDidChangeEmitter.fire();
    }
  }

  public async toggleToolAutoApprove(
    serverName: string,
    toolName: string,
    approved: boolean,
  ): Promise<void> {
    if (approved) {
      await this.toggleAllowlistEntry(serverName, toolName, true);
      return;
    }

    await this.toggleAllowlistEntry(serverName, toolName, false);
    await this.toggleAllowlistEntry(serverName, `tool:${toolName}`, false);
    await this.toggleAllowlistEntry(serverName, `@main|${toolName}`, false);
    await this.toggleAllowlistEntry(serverName, `@main|tool:${toolName}`, false);
  }

  public async toggleAllowlistEntry(
    serverName: string,
    entry: string,
    approved: boolean,
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    const serverConfig = existing[serverName];
    if (!serverConfig) {
      return;
    }

    const autoApprove = new Set(serverConfig.autoApprove ?? []);
    if (approved) {
      autoApprove.add(entry);
    } else {
      autoApprove.delete(entry);
    }

    const updated = {
      ...existing,
      [serverName]: {
        ...serverConfig,
        autoApprove: Array.from(autoApprove),
      },
    };
    await cfg.update("mcpServers", updated, vscode.ConfigurationTarget.Global);
  }

  public async updateServerTimeout(name: string, timeout: number): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const existing = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    const serverConfig = existing[name];
    if (!serverConfig) {
      return;
    }

    const updated = {
      ...existing,
      [name]: {
        ...serverConfig,
        timeout,
      },
    };
    await cfg.update("mcpServers", updated, vscode.ConfigurationTarget.Global);
  }

  public async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const server = this.servers.get(serverName);
    const connection = this.connections.get(serverName);
    if (!server || !connection || server.status !== "connected") {
      return {
        content: [
          {
            type: "text",
            text: `Server "${serverName}" is not connected.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const response = await connection.client.request(
        {
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args,
          },
        },
        CallToolResultSchema,
        {
          timeout: this.getServerTimeoutMs(server.config),
        },
      );

      return {
        content: (response.content ?? []).flatMap((item) => this.mapToolContent(item)),
        isError: response.isError,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }

  public async readResource(
    serverName: string,
    uri: string,
  ): Promise<ToolCallResult> {
    const server = this.servers.get(serverName);
    const connection = this.connections.get(serverName);
    if (!server || !connection || server.status !== "connected") {
      return {
        content: [
          {
            type: "text",
            text: `Cannot read resource: server "${serverName}" is not connected.`,
          },
        ],
        isError: true,
      };
    }

    try {
      const response = await connection.client.request(
        {
          method: "resources/read",
          params: { uri },
        },
        ReadResourceResultSchema,
        {
          timeout: this.getServerTimeoutMs(server.config),
        },
      );

      return {
        content: (response.contents ?? []).flatMap((item) => {
          const entries: ToolCallContent[] = [
            {
              type: "resource",
              uri: item.uri,
              mimeType: item.mimeType,
              text: "text" in item ? item.text : undefined,
            },
          ];
          if ("blob" in item && item.blob) {
            entries.push({
              type: "text",
              text: `[Binary resource returned: ${item.uri}]`,
            });
          }
          return entries;
        }),
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }

  public async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>,
  ): Promise<McpPromptResult> {
    const server = this.servers.get(serverName);
    const connection = this.connections.get(serverName);
    if (!server || !connection || server.status !== "connected") {
      throw new Error(`Cannot get prompt: server "${serverName}" is not connected.`);
    }

    const promptExists = server.prompts.some((prompt) => prompt.name === promptName);
    if (!promptExists) {
      throw new Error(`Prompt "${promptName}" was not found on server "${serverName}".`);
    }

    const response = await connection.client.request(
      {
        method: "prompts/get",
        params: {
          name: promptName,
          arguments: args,
        },
      },
      GetPromptResultSchema,
      {
        timeout: this.getServerTimeoutMs(server.config),
      },
    );

    return {
      description: response.description,
      messages: (response.messages ?? []).map((message) => ({
        role: message.role,
        content: this.mapPromptContent(message.content),
      })),
    };
  }

  public async runSmokeTest(config: McpServerConfig): Promise<McpSmokeTestResult> {
    const smokeServer = await this.startLocalSmokeTestServer();
    const startedAt = new Date().toISOString();
    const startedTime = Date.now();
    const steps: McpSmokeTestResult["steps"] = [];
    const tempName = `__mcp_smoke_${Date.now()}`;
    const attemptId = 1;
    this.connectionAttemptIds.set(tempName, attemptId);

    let connection: McpConnection | undefined;
    try {
      const smokeConfig: McpServerConfig = {
        transportType: "streamableHttp",
        url: smokeServer.url,
        timeout: config.timeout,
      };
      steps.push({
        status: "info",
        label: "Starting ephemeral MCP server",
        detail: smokeServer.url,
      });
      connection = await this.createConnection(tempName, smokeConfig, attemptId);
      steps.push({
        status: "success",
        label: "Connected to smoke-test transport",
      });

      const capabilityState: McpServerState = {
        name: tempName,
        config: smokeConfig,
        status: "connected",
        tools: [],
        resources: [],
        prompts: [],
      };
      const capabilities = await this.discoverCapabilities(capabilityState, connection);
      steps.push({
        status: "success",
        label: "Discovered MCP capabilities",
        detail: `${capabilities.tools.length} tools, ${capabilities.resources.length} resources, ${capabilities.prompts.length} prompts`,
      });

      let toolResultSummary: string | undefined;
      const echoTool = capabilities.tools.find((tool) => tool.name === "echo");
      if (echoTool) {
        const response = await connection.client.request(
          {
            method: "tools/call",
            params: {
              name: echoTool.name,
              arguments: {
                value: "smoke test",
              },
            },
          },
          CallToolResultSchema,
          { timeout: this.getServerTimeoutMs(smokeConfig) },
        );
        toolResultSummary = summarizeSmokeContent((response.content ?? []).flatMap((item) => this.mapToolContent(item)));
        steps.push({
          status: response.isError ? "error" : "success",
          label: `Called tool ${echoTool.name}`,
          detail: toolResultSummary,
        });
      }

      let resourceResultSummary: string | undefined;
      const smokeResource = capabilities.resources.find((resource) => resource.uri === "smoke://status");
      if (smokeResource) {
        const response = await connection.client.request(
          {
            method: "resources/read",
            params: {
              uri: smokeResource.uri,
            },
          },
          ReadResourceResultSchema,
          { timeout: this.getServerTimeoutMs(smokeConfig) },
        );
        resourceResultSummary = summarizeSmokeContent(
          (response.contents ?? []).flatMap((item) => [
            {
              type: "resource" as const,
              uri: item.uri,
              mimeType: item.mimeType,
              text: "text" in item ? item.text : undefined,
            },
          ]),
        );
        steps.push({
          status: "success",
          label: `Read resource ${smokeResource.uri}`,
          detail: resourceResultSummary,
        });
      }

      let promptResultSummary: string | undefined;
      const smokePrompt = capabilities.prompts.find((prompt) => prompt.name === "smoke-greeting");
      if (smokePrompt) {
        const response = await connection.client.request(
          {
            method: "prompts/get",
            params: {
              name: smokePrompt.name,
              arguments: {
                topic: "agent runtime",
              },
            },
          },
          GetPromptResultSchema,
          { timeout: this.getServerTimeoutMs(smokeConfig) },
        );
        promptResultSummary = summarizeSmokeContent(
          (response.messages ?? []).flatMap((message) => this.mapPromptContent(message.content)),
        );
        steps.push({
          status: "success",
          label: `Fetched prompt ${smokePrompt.name}`,
          detail: promptResultSummary,
        });
      }

      return {
        ok: true,
        startedAt,
        durationMs: Date.now() - startedTime,
        transportType: smokeConfig.transportType,
        capabilities: {
          tools: capabilities.tools.length,
          resources: capabilities.resources.length,
          prompts: capabilities.prompts.length,
        },
        toolResultSummary,
        resourceResultSummary,
        promptResultSummary,
        steps,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      steps.push({
        status: "error",
        label: "Smoke test failed",
        detail,
      });
      return {
        ok: false,
        startedAt,
        durationMs: Date.now() - startedTime,
        transportType: "streamableHttp",
        capabilities: {
          tools: 0,
          resources: 0,
          prompts: 0,
        },
        error: detail,
        steps,
      };
    } finally {
      if (connection) {
        await this.disposeConnection(tempName, connection);
      }
      this.connectionAttemptIds.delete(tempName);
      await smokeServer.dispose();
    }
  }

  public dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    this.onDidChangeEmitter.dispose();

    const serverNames = Array.from(this.connections.keys());
    for (const serverName of serverNames) {
      void this.disconnectServer(serverName);
    }
    this.connections.clear();
    this.servers.clear();
  }

  private loadFromConfig(): void {
    void this.reconcileFromConfig();
  }

  private async reconcileFromConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const raw = cfg.get<Record<string, McpServerConfig>>("mcpServers", {});
    const configuredServers = raw && typeof raw === "object" ? raw : {};
    const configuredNames = new Set(Object.keys(configuredServers));

    for (const existingName of Array.from(this.servers.keys())) {
      if (!configuredNames.has(existingName)) {
        await this.disconnectServer(existingName);
        this.servers.delete(existingName);
      }
    }

    for (const [name, config] of Object.entries(configuredServers)) {
      const existing = this.servers.get(name);

      if (!existing) {
        this.servers.set(name, {
          name,
          config,
          status: config.disabled ? "disconnected" : "connecting",
          tools: [],
          resources: [],
          prompts: [],
        });
        if (!config.disabled) {
          await this.connectServer(name);
        } else {
          this.onDidChangeEmitter.fire();
        }
        continue;
      }

      const requiresRestart = this.configRequiresRestart(existing.config, config);
      existing.config = config;

      if (config.disabled) {
        await this.disconnectServer(name, "disconnected");
        existing.error = undefined;
        existing.tools = [];
        existing.resources = [];
        existing.prompts = [];
        continue;
      }

      if (requiresRestart || existing.status === "error") {
        await this.disconnectServer(name, "connecting");
        await this.connectServer(name);
        continue;
      }

      existing.tools = existing.tools.map((tool) => ({
        ...tool,
      }));
      this.onDidChangeEmitter.fire();
    }

    this.onDidChangeEmitter.fire();
  }

  private async connectServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      return;
    }

    const attemptId = this.bumpAttemptId(name);
    server.status = "connecting";
    server.error = undefined;
    this.onDidChangeEmitter.fire();

    try {
      const connection = await this.createConnection(name, server.config, attemptId);
      if (!this.isCurrentAttempt(name, attemptId)) {
        await this.disposeConnection(name, connection);
        return;
      }

      this.connections.set(name, connection);
      const capabilities = await this.discoverCapabilities(server, connection);
      if (!this.isCurrentAttempt(name, attemptId)) {
        await this.disposeConnection(name, connection);
        return;
      }

      server.tools = capabilities.tools;
      server.resources = capabilities.resources;
      server.prompts = capabilities.prompts;
      server.status = "connected";
      server.error = undefined;
    } catch (error) {
      if (this.isCurrentAttempt(name, attemptId)) {
        server.status = "error";
        server.error = error instanceof Error ? error.message : String(error);
        server.tools = [];
        server.resources = [];
        server.prompts = [];
      }
      await this.disposeConnection(name);
    }

    this.onDidChangeEmitter.fire();
  }

  private async createConnection(
    name: string,
    config: McpServerConfig,
    attemptId: number,
  ): Promise<McpConnection> {
    const client = new Client(
      {
        name: "oci-ai-unofficial",
        version:
          vscode.extensions.getExtension("local.oci-ai-unofficial")?.packageJSON?.version ?? "0.1.9",
      },
      {
        capabilities: {},
      },
    );

    const transport = this.createTransport(name, config, attemptId);
    await client.connect(transport, {
      timeout: this.getServerTimeoutMs(config),
    });

    return { client, transport };
  }

  private createTransport(
    name: string,
    config: McpServerConfig,
    attemptId: number,
  ): McpTransport {
    const markDisconnected = (status: "disconnected" | "error", error?: string) => {
      if (!this.isCurrentAttempt(name, attemptId)) {
        return;
      }
      const server = this.servers.get(name);
      if (!server) {
        return;
      }
      server.status = status;
      if (error) {
        server.error = server.error ? `${server.error}\n${error}` : error;
      }
      if (status === "disconnected") {
        this.connections.delete(name);
      }
      this.onDidChangeEmitter.fire();
    };

    switch (config.transportType) {
      case "stdio": {
        if (!config.command?.trim()) {
          throw new Error(`MCP server "${name}" is missing a stdio command.`);
        }

        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          cwd: config.cwd?.trim() || undefined,
          env: {
            ...getDefaultEnvironment(),
            ...(config.env ?? {}),
          },
          stderr: "pipe",
        });

        const stderrStream = transport.stderr;
        stderrStream?.on("data", (chunk: Buffer | string) => {
          const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          const trimmed = message.trim();
          if (!trimmed) {
            return;
          }
          const server = this.servers.get(name);
          if (!server || !this.isCurrentAttempt(name, attemptId)) {
            return;
          }
          server.error = server.error ? `${server.error}\n${trimmed}` : trimmed;
          this.onDidChangeEmitter.fire();
        });

        transport.onerror = (error) => {
          markDisconnected("error", error instanceof Error ? error.message : String(error));
        };
        transport.onclose = () => {
          markDisconnected("disconnected");
        };
        return transport;
      }
      case "sse": {
        if (!config.url?.trim()) {
          throw new Error(`MCP server "${name}" is missing an SSE URL.`);
        }

        const transport = new SSEClientTransport(new URL(config.url), {
          requestInit: {
            headers: config.headers,
          },
        });
        transport.onerror = (error) => {
          markDisconnected("error", error instanceof Error ? error.message : String(error));
        };
        transport.onclose = () => {
          markDisconnected("disconnected");
        };
        return transport;
      }
      case "streamableHttp": {
        if (!config.url?.trim()) {
          throw new Error(`MCP server "${name}" is missing a Streamable HTTP URL.`);
        }

        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: config.headers,
          },
        });
        transport.onerror = (error) => {
          markDisconnected("error", error instanceof Error ? error.message : String(error));
        };
        transport.onclose = () => {
          markDisconnected("disconnected");
        };
        return transport;
      }
      default:
        throw new Error(`Unsupported MCP transport type: ${String((config as any).transportType)}`);
    }
  }

  private async discoverCapabilities(
    server: McpServerState,
    connection: McpConnection,
  ): Promise<{
    tools: McpToolInfo[];
    resources: McpResourceInfo[];
    prompts: McpPromptInfo[];
  }> {
    const timeout = Math.min(this.getServerTimeoutMs(server.config), DEFAULT_DISCOVERY_TIMEOUT_MS);

    const [toolsResponse, resourcesResponse, promptsResponse] = await Promise.allSettled([
      connection.client.request({ method: "tools/list" }, ListToolsResultSchema, { timeout }),
      connection.client.request({ method: "resources/list" }, ListResourcesResultSchema, { timeout }),
      connection.client.request({ method: "prompts/list" }, ListPromptsResultSchema, { timeout }),
    ]);

    const tools =
      toolsResponse.status === "fulfilled"
        ? (toolsResponse.value.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
          }))
        : [];

    const resources =
      resourcesResponse.status === "fulfilled"
        ? (resourcesResponse.value.resources ?? []).map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          }))
        : [];

    const prompts =
      promptsResponse.status === "fulfilled"
        ? (promptsResponse.value.prompts ?? []).map((prompt) => ({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments?.map((argument) => ({
              name: argument.name,
              description: argument.description,
              required: argument.required,
            })),
          }))
        : [];

    return { tools, resources, prompts };
  }

  private configRequiresRestart(oldConfig: McpServerConfig, newConfig: McpServerConfig): boolean {
    return (
      oldConfig.command !== newConfig.command ||
      oldConfig.url !== newConfig.url ||
      oldConfig.cwd !== newConfig.cwd ||
      oldConfig.transportType !== newConfig.transportType ||
      JSON.stringify(oldConfig.args ?? []) !== JSON.stringify(newConfig.args ?? []) ||
      JSON.stringify(oldConfig.env ?? {}) !== JSON.stringify(newConfig.env ?? {}) ||
      JSON.stringify(oldConfig.headers ?? {}) !== JSON.stringify(newConfig.headers ?? {}) ||
      Boolean(oldConfig.disabled) !== Boolean(newConfig.disabled)
    );
  }

  private getServerTimeoutMs(config: McpServerConfig): number {
    const timeoutSeconds = Math.max(1, Math.trunc(config.timeout ?? DEFAULT_MCP_TIMEOUT_SECONDS));
    return timeoutSeconds * 1000;
  }

  private async startLocalSmokeTestServer(): Promise<{
    url: string;
    dispose: () => Promise<void>;
  }> {
    const server = createServer(async (req, res) => {
      await this.handleLocalSmokeTestRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => reject(error);
      server.once("error", handleError);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", handleError);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine local MCP smoke-test address.");
    }

    return {
      url: `http://127.0.0.1:${(address as AddressInfo).port}/mcp`,
      dispose: () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    };
  }

  private async handleLocalSmokeTestRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "Not found",
        },
        id: null,
      }));
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: `Unsupported method: ${req.method ?? "unknown"}`,
        },
        id: null,
      }));
      return;
    }

    const parsedBody = await readJsonRequestBody(req);
    const server = createLocalSmokeMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error),
          },
          id: null,
        }));
      }
    } finally {
      await transport.close();
      await server.close();
    }
  }

  private mapToolContent(item: any): ToolCallContent[] {
    switch (item?.type) {
      case "text":
        return [{ type: "text", text: item.text }];
      case "image":
        return [
          {
            type: "image",
            dataUrl: `data:${item.mimeType};base64,${item.data}`,
            mimeType: item.mimeType,
          },
        ];
      case "audio":
        return [
          {
            type: "text",
            text: `[Audio result omitted in chat UI: ${item.mimeType ?? "unknown mime type"}]`,
          },
        ];
      case "resource":
        return [
          {
            type: "resource",
            uri: item.resource?.uri,
            mimeType: item.resource?.mimeType,
            text:
              typeof item.resource?.text === "string"
                ? item.resource.text
                : item.resource?.blob
                  ? "[Binary resource payload omitted]"
                  : undefined,
          },
        ];
      case "resource_link":
        return [
          {
            type: "resource",
            uri: item.uri,
            mimeType: item.mimeType,
            text: item.name || item.description,
          },
        ];
      default:
        return [
          {
            type: "text",
            text: JSON.stringify(item),
          },
        ];
    }
  }

  private mapPromptContent(item: any): ToolCallContent[] {
    switch (item?.type) {
      case "text":
        return [{ type: "text", text: item.text }];
      case "image":
        return item.data && item.mimeType
          ? [{ type: "image", dataUrl: `data:${item.mimeType};base64,${item.data}`, mimeType: item.mimeType }]
          : [];
      case "resource":
        if (item.resource?.text) {
          return [
            {
              type: "resource",
              uri: item.resource.uri,
              mimeType: item.resource.mimeType,
              text: item.resource.text,
            },
          ];
        }
        if (item.resource?.blob) {
          return [
            {
              type: "text",
              text: `[Binary resource returned: ${item.resource.uri}]`,
            },
          ];
        }
        return [];
      case "resource_link":
        return [
          {
            type: "text",
            text: `[Resource link] ${item.name}: ${item.uri}`,
          },
        ];
      default:
        return [];
    }
  }

  private bumpAttemptId(name: string): number {
    const next = (this.connectionAttemptIds.get(name) ?? 0) + 1;
    this.connectionAttemptIds.set(name, next);
    return next;
  }

  private isCurrentAttempt(name: string, attemptId: number): boolean {
    return this.connectionAttemptIds.get(name) === attemptId;
  }

  private async disconnectServer(
    name: string,
    nextStatus: "disconnected" | "connecting" = "disconnected",
  ): Promise<void> {
    this.bumpAttemptId(name);
    await this.disposeConnection(name);

    const server = this.servers.get(name);
    if (!server) {
      return;
    }

    server.status = nextStatus;
    if (nextStatus === "disconnected") {
      server.tools = [];
      server.resources = [];
      server.prompts = [];
    }
    this.onDidChangeEmitter.fire();
  }

  private async disposeConnection(name: string, connectionOverride?: McpConnection): Promise<void> {
    const connection = connectionOverride ?? this.connections.get(name);
    if (!connection) {
      return;
    }

    try {
      await connection.transport.close();
    } catch {
      // Ignore transport shutdown errors during reconnection or disposal.
    }

    try {
      await connection.client.close();
    } catch {
      // Ignore client shutdown errors during reconnection or disposal.
    }

    if (!connectionOverride) {
      this.connections.delete(name);
    }
  }
}

type ParsedAllowlistEntry = {
  scope: "all" | "main" | "subagents" | `subagent:${string}`;
  kind: "tool" | "prompt" | "resource";
  matcher: string;
};

function parseAllowlistEntry(entry: string): ParsedAllowlistEntry | undefined {
  const normalized = entry.trim();
  if (!normalized) {
    return undefined;
  }

  let scope: ParsedAllowlistEntry["scope"] = "all";
  let rule = normalized;
  if (normalized.startsWith("@")) {
    const separatorIndex = normalized.indexOf("|");
    if (separatorIndex <= 1 || separatorIndex >= normalized.length - 1) {
      return undefined;
    }
    scope = normalized.slice(1, separatorIndex) as ParsedAllowlistEntry["scope"];
    rule = normalized.slice(separatorIndex + 1).trim();
  }

  if (!rule || rule === "*") {
    return { scope, kind: "tool", matcher: "*" };
  }
  if (rule.startsWith("tool:")) {
    return { scope, kind: "tool", matcher: rule.slice(5).trim() || "*" };
  }
  if (rule.startsWith("prompt:")) {
    return { scope, kind: "prompt", matcher: rule.slice(7).trim() || "*" };
  }
  if (rule.startsWith("resource:")) {
    return { scope, kind: "resource", matcher: rule.slice(9).trim() || "*" };
  }

  return { scope, kind: "tool", matcher: rule };
}

function matchesAllowlistScope(scope: ParsedAllowlistEntry["scope"], context: McpAllowlistContext): boolean {
  if (scope === "all") {
    return true;
  }
  if (context.requester === "main") {
    return scope === "main";
  }
  if (scope === "subagents") {
    return true;
  }
  if (!scope.startsWith("subagent:")) {
    return false;
  }
  return scope.slice("subagent:".length).trim().toLowerCase() === String(context.subagentId ?? "").trim().toLowerCase();
}

function summarizeSmokeContent(content: ToolCallContent[]): string {
  const summary = content
    .map((item) => {
      if (item.type === "text") {
        return item.text ?? "";
      }
      if (item.type === "resource") {
        return [item.uri ?? "", item.text ?? ""].filter(Boolean).join("\n");
      }
      if (item.type === "image") {
        return `[image:${item.mimeType ?? "unknown"}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!summary) {
    return "(empty result)";
  }
  return summary.length > 600 ? `${summary.slice(0, 597)}...` : summary;
}

async function readJsonRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw);
}

function createLocalSmokeMcpServer(): McpServer {
  const server = new McpServer({
    name: "oci-ai-local-smoke-server",
    version: "1.0.0",
  });

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Return the provided value so the client can verify MCP tool execution.",
      inputSchema: {
        value: z.string().default("smoke test"),
      },
    },
    async ({ value = "smoke test" }) => ({
      content: [
        {
          type: "text",
          text: `echo:${value}`,
        },
      ],
    }),
  );

  server.registerResource(
    "smoke-status",
    "smoke://status",
    {
      title: "Smoke Status",
      description: "Static resource for the local MCP smoke test.",
      mimeType: "text/plain",
    },
    async () => ({
      contents: [
        {
          uri: "smoke://status",
          text: "status:ok",
        },
      ],
    }),
  );

  server.registerPrompt(
    "smoke-greeting",
    {
      title: "Smoke Greeting",
      description: "Simple prompt for validating MCP prompt discovery and retrieval.",
      argsSchema: {
        topic: z.string().default("agent runtime"),
      },
    },
    async ({ topic = "agent runtime" }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please confirm the smoke test for ${topic}.`,
          },
        },
      ],
    }),
  );

  return server;
}
