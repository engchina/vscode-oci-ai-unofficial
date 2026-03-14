import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const debugEnabled = process.env.MCP_SMOKE_DEBUG === "1";

function debug(message) {
  if (!debugEnabled) {
    return;
  }
  process.stderr.write(`[smoke-server] ${message}\n`);
}

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

const transport = new StdioServerTransport();
const keepAliveTimer = setInterval(() => {
  // Keep the process alive while the stdio transport is attached to a piped stdin.
}, 1000);

function shutdown(exitCode = 0) {
  clearInterval(keepAliveTimer);
  process.exit(exitCode);
}

async function main() {
  process.stdin.resume();
  process.stdin.on("data", (chunk) => {
    debug(`stdin ${chunk.length} bytes`);
  });
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  server.server.oninitialized = () => {
    debug("client initialized");
  };
  debug("connecting stdio transport");
  await server.connect(transport);
  debug("stdio transport connected");
}

main().catch((error) => {
  clearInterval(keepAliveTimer);
  process.stderr.write(`local smoke server failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
