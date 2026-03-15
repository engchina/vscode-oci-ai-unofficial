/**
 * Bootstrap file service for agent persona and workspace context.
 *
 * Manages the OpenClaw-style bootstrap files (AGENTS.md, SOUL.md, IDENTITY.md,
 * USER.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md) that define the
 * agent's personality, user profile, and workspace-level long-term memory.
 *
 * These files live in the workspace root (or a `.oci-ai` subdirectory) and are
 * injected into the system prompt so the LLM can embody the configured persona.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  BOOTSTRAP_FILE_NAMES,
  type BootstrapFile,
  type BootstrapFileName,
  type BootstrapState,
} from "../shared/mcp-types";

/** Files that are always created on workspace init (BOOTSTRAP.md only on first run). */
const INIT_FILES: BootstrapFileName[] = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
];

/** Files included in subagent/lightweight contexts (smaller set for safety). */
const MINIMAL_ALLOWLIST: Set<BootstrapFileName> = new Set([
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
]);

/** Per-file content budget (chars) before truncation. */
const PER_FILE_BUDGET = 20_000;
/** Total content budget (chars) across all files. */
const TOTAL_BUDGET = 150_000;

export class AgentBootstrapService {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private watcher: fs.FSWatcher | undefined;
  private state: BootstrapState | undefined;

  constructor(private readonly extensionPath: string) {
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.reload();
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Get the current bootstrap state (loads lazily). */
  public getState(): BootstrapState | undefined {
    if (!this.state) {
      this.reload();
    }
    return this.state;
  }

  /** Reload bootstrap files from disk. */
  public reload(): void {
    const dir = this.resolveBootstrapDirectory();
    if (!dir) {
      this.state = undefined;
      this.disposeWatcher();
      return;
    }

    const files = this.loadFiles(dir);
    const isBrandNew = files.some((f) => f.name === "BOOTSTRAP.md" && f.exists);

    this.state = { directory: dir, files, isBrandNew };
    this.configureWatcher(dir);
    this.onDidChangeEmitter.fire();
  }

  /**
   * Ensure bootstrap files exist in the workspace.
   * Copies missing template files from bundled resources.
   * If `firstRun` is true, also writes BOOTSTRAP.md.
   */
  public async ensureWorkspaceFiles(firstRun?: boolean): Promise<string | undefined> {
    const dir = this.resolveBootstrapDirectory();
    if (!dir) {
      return undefined;
    }

    const templatesDir = this.resolveTemplatesDirectory();
    if (!templatesDir) {
      return undefined;
    }

    const shouldCreateBootstrap = firstRun ?? !this.hasBootstrapFiles();
    const filesToWrite = shouldCreateBootstrap
      ? [...INIT_FILES, "BOOTSTRAP.md" as BootstrapFileName]
      : INIT_FILES;

    for (const fileName of filesToWrite) {
      const targetPath = path.join(dir, fileName);
      if (fs.existsSync(targetPath)) {
        continue;
      }
      const templatePath = path.join(templatesDir, fileName);
      if (!fs.existsSync(templatePath)) {
        continue;
      }
      try {
        const content = fs.readFileSync(templatePath, "utf-8");
        fs.writeFileSync(targetPath, content, "utf-8");
      } catch {
        // Best effort — don't break agent activation if a template write fails.
      }
    }

    this.reload();
    return dir;
  }

  /**
   * Build the "Project Context" section for the system prompt.
   *
   * @param minimal  If true, only include the minimal set of files (for subagent contexts).
   */
  public buildSystemPromptSection(minimal = false): string {
    const state = this.getState();
    if (!state || state.files.length === 0) {
      return "";
    }

    const allowedFiles = state.files.filter((f) => {
      if (!f.exists || !f.content.trim()) {
        return false;
      }
      if (minimal && !MINIMAL_ALLOWLIST.has(f.name)) {
        return false;
      }
      return true;
    });

    if (allowedFiles.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("# Project Context");
    lines.push("");
    lines.push("The following workspace context files have been loaded.");
    lines.push("Read them to understand your identity, the user, and the project.");

    // Special SOUL.md directive (matches OpenClaw behavior)
    const hasSoul = allowedFiles.some((f) => f.name === "SOUL.md");
    if (hasSoul) {
      lines.push("");
      lines.push(
        "If SOUL.md is present, embody its persona and tone. " +
        "Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      );
    }

    lines.push("");

    let totalChars = 0;
    for (const file of allowedFiles) {
      let content = file.content;

      // Per-file truncation
      if (content.length > PER_FILE_BUDGET) {
        content = smartTruncate(content, PER_FILE_BUDGET);
      }

      // Total budget guard
      if (totalChars + content.length > TOTAL_BUDGET) {
        const remaining = TOTAL_BUDGET - totalChars;
        if (remaining > 200) {
          content = smartTruncate(content, remaining);
        } else {
          lines.push(`## ${file.name}`);
          lines.push("[Omitted — context budget exceeded]");
          lines.push("");
          continue;
        }
      }

      lines.push(`## ${file.name}`);
      lines.push(content);
      lines.push("");
      totalChars += content.length;
    }

    return lines.join("\n");
  }

  /** Check if any bootstrap files exist in the workspace. */
  public hasBootstrapFiles(): boolean {
    const state = this.getState();
    return state !== undefined && state.files.some((f) => f.exists);
  }

  /** Get the content of a specific bootstrap file. */
  public getFileContent(name: BootstrapFileName): string | undefined {
    const state = this.getState();
    if (!state) {
      return undefined;
    }
    const file = state.files.find((f) => f.name === name);
    return file?.exists ? file.content : undefined;
  }

  /** Write content to a specific bootstrap file. */
  public async writeFile(name: BootstrapFileName, content: string): Promise<void> {
    const dir = this.resolveBootstrapDirectory();
    if (!dir) {
      throw new Error("No workspace folder is open.");
    }
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content, "utf-8");
    this.reload();
  }

  /** Delete a bootstrap file (e.g. BOOTSTRAP.md after onboarding). */
  public async deleteFile(name: BootstrapFileName): Promise<void> {
    const dir = this.resolveBootstrapDirectory();
    if (!dir) {
      return;
    }
    const filePath = path.join(dir, name);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // File may not exist — that's fine.
    }
    this.reload();
  }

  public dispose(): void {
    this.disposeWatcher();
    this.onDidChangeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private resolveBootstrapDirectory(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      return undefined;
    }
    // Prefer .oci-ai/ subdirectory if it already exists, otherwise use workspace root.
    const ociAiDir = path.join(workspaceFolder, ".oci-ai");
    if (directoryExists(ociAiDir)) {
      return ociAiDir;
    }
    return workspaceFolder;
  }

  private resolveTemplatesDirectory(): string | undefined {
    const candidates = [
      path.join(this.extensionPath, "docs", "reference", "templates"),
      path.join(this.extensionPath, "resources", "bootstrap-templates"),
    ];
    return candidates.find((candidate) => directoryExists(candidate));
  }

  private loadFiles(dir: string): BootstrapFile[] {
    return BOOTSTRAP_FILE_NAMES.map((name) => {
      const filePath = path.join(dir, name);
      let content = "";
      let exists = false;
      try {
        content = fs.readFileSync(filePath, "utf-8");
        exists = true;
      } catch {
        // File doesn't exist — that's expected for optional files like MEMORY.md.
      }
      return { name, path: filePath, content, exists };
    });
  }

  private configureWatcher(dir: string): void {
    this.disposeWatcher();
    try {
      let debounceTimer: NodeJS.Timeout | undefined;
      this.watcher = fs.watch(dir, (_, filename) => {
        if (!filename) {
          return;
        }
        // Only react to bootstrap file changes
        const upper = filename.toUpperCase();
        const isBootstrapFile = (BOOTSTRAP_FILE_NAMES as readonly string[]).some(
          (n) => n.toUpperCase() === upper,
        );
        if (!isBootstrapFile) {
          return;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          this.reload();
        }, 300);
      });
    } catch {
      // fs.watch may not be supported on all platforms.
    }
  }

  private disposeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function directoryExists(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Smart truncation: keep head (70%) + tail (20%) with a marker in between.
 * This preserves both the beginning (identity/setup) and end (recent notes) of a file.
 */
function smartTruncate(text: string, budget: number): string {
  if (text.length <= budget) {
    return text;
  }
  const headLen = Math.floor(budget * 0.7);
  const tailLen = Math.floor(budget * 0.2);
  const marker = `\n\n[... ${text.length - headLen - tailLen} chars truncated ...]\n\n`;
  return text.slice(0, headLen) + marker + text.slice(-tailLen);
}
