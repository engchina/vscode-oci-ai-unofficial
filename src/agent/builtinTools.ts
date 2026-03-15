/**
 * Built-in tool implementations for agent mode.
 *
 * These tools provide core coding-agent capabilities (file read/write,
 * command execution, web search, browser fetch) that work independently
 * of MCP servers — modelled after OpenClaw's built-in tool set.
 */
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import type { AgentEnabledTools, ToolCallResult } from "../shared/mcp-types";

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export interface BuiltinToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** All built-in tool definitions exposed to the LLM via the system prompt. */
export function getBuiltinToolDefinitions(): BuiltinToolDefinition[] {
  return [
    {
      name: "readFile",
      description:
        "Read the contents of a file at the given path. " +
        "Returns the file text. Use this to inspect source code, configs, or any text file in the workspace. " +
        "For binary files only the first 1 KB (hex) is returned.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative file path.",
          },
          startLine: {
            type: "number",
            description: "Optional 1-based start line (inclusive).",
          },
          endLine: {
            type: "number",
            description: "Optional 1-based end line (inclusive).",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "writeFile",
      description:
        "Create or overwrite a file with the given content. " +
        "Parent directories are created automatically. " +
        "Use this to write new files or fully replace existing ones.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative file path.",
          },
          content: {
            type: "string",
            description: "Full file content to write.",
          },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "executeCommand",
      description:
        "Execute a shell command in the workspace root and return its stdout/stderr. " +
        "Use this for running builds, tests, git operations, listing files, etc. " +
        "Commands run with a 60-second timeout by default.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute.",
          },
          cwd: {
            type: "string",
            description: "Optional working directory (defaults to workspace root).",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default 60000).",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "listFiles",
      description:
        "List files and directories at the given path. " +
        "Returns entries with type indicators (file/dir). " +
        "Useful for exploring project structure before reading specific files.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative directory path. Defaults to workspace root.",
          },
          recursive: {
            type: "boolean",
            description: "If true, list recursively (max 500 entries). Default false.",
          },
        },
        required: [],
      },
    },
    {
      name: "searchFiles",
      description:
        "Search for a text pattern (regex) across files in the workspace. " +
        "Returns matching lines with file paths and line numbers. " +
        "Use this to find function definitions, variable usages, error strings, etc.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for.",
          },
          path: {
            type: "string",
            description: "Directory to search in (defaults to workspace root).",
          },
          include: {
            type: "string",
            description: "Glob pattern for files to include (e.g. '*.ts').",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results (default 50).",
          },
        },
        required: ["pattern"],
      },
    },
    {
      name: "webSearch",
      description:
        "Search the web for information using a search query. " +
        "Returns search results with titles, URLs, and snippets. " +
        "Requires a BRAVE_API_KEY environment variable to be set. " +
        "Use this when you need up-to-date information from the internet.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string.",
          },
          count: {
            type: "number",
            description: "Number of results to return (1-10, default 5).",
          },
          country: {
            type: "string",
            description: "2-letter country code for region-specific results (e.g. 'US', 'JP'). Default 'US'.",
          },
          freshness: {
            type: "string",
            description: "Filter by time: 'day' (24h), 'week', 'month', or 'year'.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "fetchUrl",
      description:
        "Fetch the text content of a web page by URL. " +
        "Returns the page body as plain text (HTML tags stripped). " +
        "Use this to read documentation, API references, articles, or any web page.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch.",
          },
          maxLength: {
            type: "number",
            description: "Maximum characters to return (default 30000).",
          },
        },
        required: ["url"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 512 * 1024; // 512 KB text read limit
const MAX_OUTPUT_LENGTH = 32_000; // truncate long outputs
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 50;

function resolveWorkspacePath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    throw new Error("No workspace folder is open.");
  }
  return path.resolve(workspaceFolder, filePath);
}

function truncateOutput(text: string, limit = MAX_OUTPUT_LENGTH): string {
  if (text.length <= limit) {
    return text;
  }
  const headLen = Math.floor(limit * 0.7);
  const tailLen = Math.floor(limit * 0.25);
  const omitted = text.length - headLen - tailLen;
  return `${text.slice(0, headLen)}\n\n[... ${omitted} chars omitted ...]\n\n${text.slice(-tailLen)}`;
}

/** Check whether a built-in tool is enabled in settings. */
export function isBuiltinToolEnabled(toolName: string, enabledTools: AgentEnabledTools): boolean {
  // listFiles and searchFiles are gated by readFile; fetchUrl is gated by webSearch
  const gateMap: Record<string, keyof AgentEnabledTools> = {
    listFiles: "readFile",
    searchFiles: "readFile",
    fetchUrl: "webSearch",
  };
  const gateKey = (gateMap[toolName] ?? toolName) as keyof AgentEnabledTools;
  return enabledTools[gateKey] !== false;
}

/** Execute a built-in tool by name. */
export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case "readFile":
        return await executeReadFile(args);
      case "writeFile":
        return await executeWriteFile(args);
      case "executeCommand":
        return await executeShellCommand(args);
      case "listFiles":
        return await executeListFiles(args);
      case "searchFiles":
        return await executeSearchFiles(args);
      case "webSearch":
        return await executeWebSearch(args);
      case "fetchUrl":
        return await executeFetchUrl(args);
      default:
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown built-in tool: ${toolName}` }],
        };
    }
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

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------
async function executeReadFile(args: Record<string, unknown>): Promise<ToolCallResult> {
  const filePath = String(args.path ?? "");
  if (!filePath) {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: path" }] };
  }

  const resolved = resolveWorkspacePath(filePath);

  if (!fs.existsSync(resolved)) {
    return { isError: true, content: [{ type: "text", text: `File not found: ${resolved}` }] };
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    return { isError: true, content: [{ type: "text", text: `Path is a directory, not a file: ${resolved}` }] };
  }

  if (stat.size > MAX_FILE_SIZE) {
    // Check binary before attempting chunked text read
    const probeSize = Math.min(stat.size, 8192);
    const probeBuf = Buffer.alloc(probeSize);
    const probeFd = fs.openSync(resolved, "r");
    try {
      fs.readSync(probeFd, probeBuf, 0, probeSize, 0);
    } finally {
      fs.closeSync(probeFd);
    }
    if (isBinaryBuffer(probeBuf)) {
      const hex = probeBuf.slice(0, 1024).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
      return {
        content: [
          {
            type: "text",
            text: `[Binary file: ${resolved} (${stat.size} bytes)]\nFirst 1024 bytes (hex):\n${hex}`,
          },
        ],
      };
    }
    // For very large files, read only the requested range or the first chunk
    const startLine = typeof args.startLine === "number" ? args.startLine : 1;
    const endLine = typeof args.endLine === "number" ? args.endLine : startLine + 200;
    return readFileLines(resolved, startLine, endLine, stat.size);
  }

  const raw = fs.readFileSync(resolved);

  // Detect binary content
  if (isBinaryBuffer(raw)) {
    const hex = raw.slice(0, 1024).toString("hex").match(/.{1,2}/g)?.join(" ") ?? "";
    return {
      content: [
        {
          type: "text",
          text: `[Binary file: ${resolved} (${stat.size} bytes)]\nFirst 1024 bytes (hex):\n${hex}`,
        },
      ],
    };
  }

  let text = raw.toString("utf-8");

  const startLine = typeof args.startLine === "number" ? args.startLine : undefined;
  const endLine = typeof args.endLine === "number" ? args.endLine : undefined;

  if (startLine !== undefined || endLine !== undefined) {
    const lines = text.split("\n");
    const start = Math.max(1, startLine ?? 1) - 1;
    const end = Math.min(lines.length, endLine ?? lines.length);
    const numberedLines = lines.slice(start, end).map((line, i) => `${start + i + 1}\t${line}`);
    text = numberedLines.join("\n");
  } else {
    // Add line numbers
    const lines = text.split("\n");
    text = lines.map((line, i) => `${i + 1}\t${line}`).join("\n");
  }

  return {
    content: [{ type: "text", text: truncateOutput(text) }],
  };
}

function readFileLines(
  filePath: string,
  startLine: number,
  endLine: number,
  totalSize: number,
): ToolCallResult {
  // Read in chunks to avoid loading the entire large file into memory.
  const numbered: string[] = [];
  const start = Math.max(1, startLine) - 1;
  const end = endLine;
  let lineIndex = 0;
  let totalLines = 0;
  let remainder = "";
  let bytesConsumed = 0;

  // Synchronous approach: read in chunks, split into lines.
  const fd = fs.openSync(filePath, "r");
  try {
    const chunkSize = 64 * 1024;
    const buf = Buffer.alloc(chunkSize);
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buf, 0, chunkSize, null)) > 0) {
      bytesConsumed += bytesRead;
      const chunk = remainder + buf.toString("utf-8", 0, bytesRead);
      const lines = chunk.split("\n");
      // Last element is a partial line (or empty if chunk ended with \n)
      remainder = lines.pop() ?? "";

      for (const line of lines) {
        totalLines++;
        if (lineIndex >= start && lineIndex < end) {
          numbered.push(`${lineIndex + 1}\t${line}`);
        }
        lineIndex++;
        if (lineIndex >= end && numbered.length > 0) {
          // Estimate total lines from bytes consumed so far vs total file size.
          const avgLineLen = bytesConsumed / (totalLines || 1);
          const estimatedTotal = Math.round(totalSize / Math.max(avgLineLen, 1));
          const header = `[File: ${filePath} (${totalSize} bytes, ~${estimatedTotal} lines) — showing lines ${start + 1}-${Math.min(end, lineIndex)}]`;
          return {
            content: [{ type: "text", text: `${header}\n${truncateOutput(numbered.join("\n"))}` }],
          };
        }
      }
    }
    // Handle the last partial line
    if (remainder) {
      totalLines++;
      if (lineIndex >= start && lineIndex < end) {
        numbered.push(`${lineIndex + 1}\t${remainder}`);
      }
      lineIndex++;
    }
  } finally {
    fs.closeSync(fd);
  }

  const header = `[File: ${filePath} (${totalSize} bytes, ${totalLines} lines) — showing lines ${start + 1}-${Math.min(end, lineIndex)}]`;
  return {
    content: [{ type: "text", text: `${header}\n${truncateOutput(numbered.join("\n"))}` }],
  };
}

function isBinaryBuffer(buf: Buffer): boolean {
  const checkLength = Math.min(buf.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    const byte = buf[i];
    if (byte === 0) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------
async function executeWriteFile(args: Record<string, unknown>): Promise<ToolCallResult> {
  const filePath = String(args.path ?? "");
  const content = String(args.content ?? "");
  if (!filePath) {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: path" }] };
  }

  const resolved = resolveWorkspacePath(filePath);
  const dir = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existed = fs.existsSync(resolved);
  fs.writeFileSync(resolved, content, "utf-8");

  const lineCount = content.split("\n").length;
  return {
    content: [
      {
        type: "text",
        text: `${existed ? "Updated" : "Created"} ${resolved} (${lineCount} lines, ${content.length} bytes).`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// executeCommand
// ---------------------------------------------------------------------------
async function executeShellCommand(args: Record<string, unknown>): Promise<ToolCallResult> {
  const command = String(args.command ?? "");
  if (!command) {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: command" }] };
  }

  const cwd = args.cwd
    ? resolveWorkspacePath(String(args.cwd))
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const timeout = typeof args.timeout === "number" ? args.timeout : COMMAND_TIMEOUT_MS;

  return new Promise<ToolCallResult>((resolve) => {
    cp.exec(
      command,
      {
        cwd,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: "0" },
      },
      (error, stdout, stderr) => {
        const parts: string[] = [];
        if (stdout) {
          parts.push(stdout);
        }
        if (stderr) {
          parts.push(`[stderr]\n${stderr}`);
        }
        if (error && error.killed) {
          parts.push(`[Command timed out after ${timeout}ms]`);
        } else if (error) {
          parts.push(`[Exit code: ${error.code ?? "unknown"}]`);
        }
        const output = parts.join("\n").trim() || "(no output)";
        // Only mark as error for timeouts, exit codes > 1, or spawn failures.
        // Exit code 1 is common for commands like grep (no match) and is not a real error.
        const exitCode = error?.code;
        const isRealError = error
          ? !!(error.killed || (typeof exitCode === "number" ? exitCode > 1 : exitCode !== undefined))
          : false;
        resolve({
          isError: isRealError,
          content: [{ type: "text", text: truncateOutput(output) }],
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// listFiles
// ---------------------------------------------------------------------------
async function executeListFiles(args: Record<string, unknown>): Promise<ToolCallResult> {
  const targetPath = resolveWorkspacePath(String(args.path ?? "."));
  const recursive = args.recursive === true;

  if (!fs.existsSync(targetPath)) {
    return { isError: true, content: [{ type: "text", text: `Path not found: ${targetPath}` }] };
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return { isError: true, content: [{ type: "text", text: `Not a directory: ${targetPath}` }] };
  }

  const entries: string[] = [];
  const visitedDirs = new Set<string>();
  const collect = (dir: string, prefix: string) => {
    if (entries.length >= MAX_LIST_ENTRIES) {
      return;
    }
    // Resolve real path to detect symlink loops
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visitedDirs.has(realDir)) {
      return;
    }
    visitedDirs.add(realDir);

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort: directories first, then files
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const item of items) {
      if (entries.length >= MAX_LIST_ENTRIES) {
        break;
      }
      // Skip common noise
      if (item.name === "node_modules" || item.name === ".git") {
        entries.push(`${prefix}${item.name}/ (skipped)`);
        continue;
      }
      if (item.isDirectory()) {
        entries.push(`${prefix}${item.name}/`);
        if (recursive) {
          collect(path.join(dir, item.name), `${prefix}  `);
        }
      } else {
        entries.push(`${prefix}${item.name}`);
      }
    }
  };

  collect(targetPath, "");

  if (entries.length >= MAX_LIST_ENTRIES) {
    entries.push(`\n[Truncated at ${MAX_LIST_ENTRIES} entries]`);
  }

  return {
    content: [{ type: "text", text: entries.join("\n") || "(empty directory)" }],
  };
}

// ---------------------------------------------------------------------------
// searchFiles
// ---------------------------------------------------------------------------
async function executeSearchFiles(args: Record<string, unknown>): Promise<ToolCallResult> {
  const pattern = String(args.pattern ?? "");
  if (!pattern) {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: pattern" }] };
  }

  const searchPath = resolveWorkspacePath(String(args.path ?? "."));
  const include = args.include ? String(args.include) : undefined;
  const maxResults = typeof args.maxResults === "number" ? Math.min(args.maxResults, MAX_SEARCH_RESULTS) : MAX_SEARCH_RESULTS;

  // Validate the pattern by constructing a regex once.
  try {
    new RegExp(pattern, "i");
  } catch {
    return { isError: true, content: [{ type: "text", text: `Invalid regex: ${pattern}` }] };
  }

  const results: string[] = [];

  const searchDir = (dir: string) => {
    if (results.length >= maxResults) {
      return;
    }
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (results.length >= maxResults) {
        break;
      }
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === "node_modules" || item.name === ".git" || item.name === "dist" || item.name === "out") {
          continue;
        }
        searchDir(fullPath);
      } else {
        if (include) {
          const globMatch = matchSimpleGlob(item.name, include);
          if (!globMatch) {
            continue;
          }
        }
        searchInFile(fullPath, pattern, results, maxResults);
      }
    }
  };

  searchDir(searchPath);

  if (results.length === 0) {
    return { content: [{ type: "text", text: `No matches found for pattern: ${pattern}` }] };
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const formatted = results.map((r) => {
    if (!workspaceRoot) {
      return r;
    }
    // searchInFile produces "absolutePath:lineNo: content".
    // Use startsWith to strip the workspace root prefix safely.
    const prefix = workspaceRoot + path.sep;
    if (r.startsWith(prefix)) {
      return r.slice(prefix.length);
    }
    return r;
  });

  return {
    content: [{ type: "text", text: formatted.join("\n") }],
  };
}

function searchInFile(filePath: string, pattern: string, results: string[], maxResults: number): void {
  let content: string;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      return;
    }
    const buf = fs.readFileSync(filePath);
    if (isBinaryBuffer(buf)) {
      return;
    }
    content = buf.toString("utf-8");
  } catch {
    return;
  }

  // Create a fresh non-global regex per file to avoid lastIndex issues.
  const regex = new RegExp(pattern, "i");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && results.length < maxResults; i++) {
    if (regex.test(lines[i])) {
      results.push(`${filePath}:${i + 1}: ${lines[i].trimEnd()}`);
    }
  }
}

function matchSimpleGlob(fileName: string, globPattern: string): boolean {
  // Simple glob: *.ext or **/*.ext
  // First escape all regex-special chars except * and ?
  const escaped = globPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/___DOUBLESTAR___/g, ".*");
  try {
    return new RegExp(`^${pattern}$`, "i").test(fileName);
  } catch {
    // If the pattern is somehow still invalid, fall back to simple extension check.
    return fileName.endsWith(globPattern.replace(/^\*+/, ""));
  }
}

// ---------------------------------------------------------------------------
// webSearch (Brave Search API)
// ---------------------------------------------------------------------------

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const WEB_SEARCH_TIMEOUT_MS = 15_000;

async function executeWebSearch(args: Record<string, unknown>): Promise<ToolCallResult> {
  const query = String(args.query ?? "").trim();
  if (!query) {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: query" }] };
  }

  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return {
      isError: true,
      content: [{ type: "text", text: "Web search is not configured. Set the BRAVE_API_KEY environment variable to enable it." }],
    };
  }

  const count = Math.max(1, Math.min(10, typeof args.count === "number" ? args.count : 5));
  const country = typeof args.country === "string" ? args.country : "US";
  const freshness = typeof args.freshness === "string" ? args.freshness : undefined;

  const params = new URLSearchParams({
    q: query,
    count: String(count),
    country,
    text_decorations: "false",
  });
  if (freshness) {
    params.set("freshness", freshness);
  }

  const url = `${BRAVE_SEARCH_ENDPOINT}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        isError: true,
        content: [{ type: "text", text: `Brave Search API error (${response.status}): ${body.slice(0, 500)}` }],
      };
    }

    const data = (await response.json()) as BraveSearchResponse;
    const results = (data.web?.results ?? []).slice(0, count);

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No results found for: ${query}` }] };
    }

    const formatted = results
      .map((r, i) => {
        const parts = [`${i + 1}. ${r.title}`];
        parts.push(`   URL: ${r.url}`);
        if (r.description) {
          parts.push(`   ${r.description}`);
        }
        if (r.page_age) {
          parts.push(`   Published: ${r.page_age}`);
        }
        return parts.join("\n");
      })
      .join("\n\n");

    return {
      content: [{ type: "text", text: `Search results for "${query}" (${results.length} results):\n\n${formatted}` }],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { isError: true, content: [{ type: "text", text: "Web search timed out." }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Web search failed: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title: string;
      url: string;
      description?: string;
      page_age?: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// fetchUrl (web page text extraction)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_FETCH_LENGTH = 30_000;

async function executeFetchUrl(args: Record<string, unknown>): Promise<ToolCallResult> {
  const url = String(args.url ?? "").trim();
  if (!url) {
    return { isError: true, content: [{ type: "text", text: "Missing required parameter: url" }] };
  }

  // Basic URL validation
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { isError: true, content: [{ type: "text", text: `Invalid URL: ${url}` }] };
  }

  if (!parsed.protocol.startsWith("http")) {
    return { isError: true, content: [{ type: "text", text: "Only http/https URLs are supported." }] };
  }

  const maxLength = typeof args.maxLength === "number"
    ? Math.max(1000, Math.min(args.maxLength, 200_000))
    : DEFAULT_MAX_FETCH_LENGTH;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OCI-AI-Agent/1.0)",
          Accept: "text/html, application/xhtml+xml, text/plain, */*",
        },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `HTTP ${response.status} ${response.statusText} fetching ${url}` }],
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();

    let text: string;
    if (contentType.includes("html")) {
      text = stripHtmlTags(raw);
    } else {
      text = raw;
    }

    // Collapse excessive whitespace
    text = text.replace(/\n{3,}/g, "\n\n").trim();

    if (text.length > maxLength) {
      text = truncateOutput(text, maxLength);
    }

    if (!text) {
      return { content: [{ type: "text", text: `(Page at ${url} returned no text content)` }] };
    }

    return {
      content: [{ type: "text", text: `Content from ${url}:\n\n${text}` }],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { isError: true, content: [{ type: "text", text: `Fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}` }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Fetch failed: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
}

/**
 * Strip HTML tags and extract readable text content.
 * Removes script, style, noscript, and head elements entirely.
 */
function stripHtmlTags(html: string): string {
  let text = html;
  // Remove script, style, noscript, and head blocks
  text = text.replace(/<(script|style|noscript|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Convert block elements to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr|blockquote|pre|section|article|header|footer|nav|main)\b[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return text;
}
