import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type {
  AgentSkillConfigEntry,
  AgentSkillsConfig,
  AgentSkillsState,
  AgentSkillSource,
  AgentSkillSummary,
} from "../shared/mcp-types";

const AGENT_SKILLS_CONFIG_KEY = "ociAi.agentSkills";
const DEFAULT_AGENT_SKILLS_CONFIG: AgentSkillsConfig = {
  entries: {},
  load: {
    extraDirs: [],
    watch: true,
    watchDebounceMs: 300,
    includeBundled: true,
    includeWorkspace: true,
    includeUser: true,
  },
};

type SkillRoot = {
  source: AgentSkillSource;
  directory: string;
};

type ParsedSkillFile = {
  frontmatter: {
    name?: string;
    description?: string;
    homepage?: string;
    userInvocable?: boolean;
    disableModelInvocation?: boolean;
    commandDispatch?: "tool";
    commandTool?: string;
    commandArgMode?: "raw";
    metadata?: Record<string, unknown>;
  };
  instructions: string;
};

type ResolvedSkill = {
  summary: AgentSkillSummary;
  instructions: string;
};

type SkillOpenClawMetadata = {
  os?: string[];
  env?: string[];
  bins?: string[];
  enabled?: boolean;
};

export type SkillTurnContext =
  | {
      kind: "local-response";
      responseText: string;
    }
  | {
      kind: "model";
      userText: string;
      runtimeSystemPrompt?: string;
      slashCommandName?: string;
    }
  | {
      kind: "tool-dispatch";
      slashCommandName: string;
      dispatchMode: "tool";
      toolName: string;
      commandArgMode: "raw";
      argumentText: string;
      skillName: string;
      userText: string;
      runtimeSystemPrompt?: string;
    };

export class AgentSkillService {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: fs.FSWatcher[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private state: AgentSkillsState = {
    skills: [],
    watched: false,
      sources: {
        workspaceDirs: [],
        userDirs: [],
        extraDirs: [],
      },
  };
  private resolvedSkills = new Map<string, ResolvedSkill>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly extensionPath: string) {
    this.refresh();

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("ociAi.agentSkills")) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.refresh();
      }),
    );
  }

  public getState(): AgentSkillsState {
    return this.state;
  }

  public refresh(): void {
    const config = this.getConfig();
    const roots = this.resolveSkillRoots(config);
    const resolvedSkills = new Map<string, ResolvedSkill>();

    for (const root of roots) {
      for (const skill of this.loadSkillsFromRoot(root, config.entries ?? {})) {
        if (!resolvedSkills.has(skill.summary.id)) {
          resolvedSkills.set(skill.summary.id, skill);
        }
      }
    }

    this.disposeWatchers();
    this.resolvedSkills = resolvedSkills;
    this.state = {
      skills: Array.from(resolvedSkills.values())
        .map((skill) => skill.summary)
        .sort((left, right) => left.name.localeCompare(right.name)),
      watched: false,
      sources: {
        bundledDir: roots.find((root) => root.source === "bundled")?.directory,
        workspaceDirs: roots.filter((root) => root.source === "workspace").map((root) => root.directory),
        userDirs: roots.filter((root) => root.source === "user").map((root) => root.directory),
        extraDirs: roots.filter((root) => root.source === "extra").map((root) => root.directory),
      },
    };

    this.configureWatchers(roots, config);
    this.state = {
      ...this.state,
      watched: this.watchers.length > 0,
    };
    this.onDidChangeEmitter.fire();
  }

  public async toggleSkill(skillId: string, enabled: boolean): Promise<void> {
    const config = this.getConfig();
    const nextEntries = {
      ...(config.entries ?? {}),
      [skillId]: {
        ...(config.entries?.[skillId] ?? {}),
        enabled,
      },
    };
    const nextConfig: AgentSkillsConfig = {
      ...config,
      entries: nextEntries,
    };

    await vscode.workspace
      .getConfiguration("ociAi")
      .update("agentSkills", nextConfig, vscode.ConfigurationTarget.Global);
  }

  public prepareTurn(rawText: string): SkillTurnContext {
    const text = rawText.trim();
    const manifest = this.formatAvailableSkillsManifest();

    if (!text) {
      return {
        kind: "model",
        userText: rawText,
        runtimeSystemPrompt: manifest,
      };
    }

    if (text === "/skills") {
      return {
        kind: "local-response",
        responseText: this.renderSkillsSummary(),
      };
    }

    const commandMatch = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/i);
    if (!commandMatch) {
      return {
        kind: "model",
        userText: rawText,
        runtimeSystemPrompt: manifest,
      };
    }

    const commandName = normalizeSlashCommandName(commandMatch[1]);
    if (!commandName || commandName === "skills" || commandName === "commands" || commandName === "help") {
      return {
        kind: "model",
        userText: rawText,
        runtimeSystemPrompt: manifest,
      };
    }

    const commandArgs = (commandMatch[2] ?? "").trim();
    if (commandName === "skill") {
      const skillMatch = commandArgs.match(/^([^\s]+)(?:\s+([\s\S]*))?$/i);
      if (!skillMatch) {
        return {
          kind: "local-response",
          responseText:
            "Usage: `/skill <id> <task>`\n\n" +
            "Run `/skills` to see the currently discovered skills.",
        };
      }
      return this.resolveSkillCommand(skillMatch[1], skillMatch[2] ?? "", manifest, commandName);
    }

    const selectedSkill = Array.from(this.resolvedSkills.values()).find(
      (skill) => skill.summary.userInvocable && skill.summary.slashCommandName === commandName,
    );
    if (!selectedSkill) {
      return {
        kind: "model",
        userText: rawText,
        runtimeSystemPrompt: manifest,
      };
    }

    return this.resolveSkillCommand(selectedSkill.summary.id, commandArgs, manifest, commandName);
  }

  public getSlashCommands(): Array<{
    command: string;
    description?: string;
    kind: "skill" | "tool-dispatch";
  }> {
    return this.state.skills
      .filter((skill) => skill.userInvocable && skill.effectiveEnabled && skill.slashCommandName)
      .map((skill) => ({
        command: skill.slashCommandName!,
        description: skill.description,
        kind: skill.commandDispatch === "tool" ? ("tool-dispatch" as const) : ("skill" as const),
      }))
      .sort((left, right) => left.command.localeCompare(right.command));
  }

  private resolveSkillCommand(
    rawSkillId: string,
    rawInvocationText: string,
    manifest: string,
    slashCommandName: string,
  ): SkillTurnContext {
    const skillId = normalizeSkillId(rawSkillId);
    const selectedSkill = this.resolvedSkills.get(skillId);
    if (!selectedSkill) {
      return {
        kind: "local-response",
        responseText:
          `Skill "${rawSkillId}" was not found.\n\n` +
          "Run `/skills` to see the currently discovered skills.",
      };
    }

    if (!selectedSkill.summary.userInvocable) {
      return {
        kind: "local-response",
        responseText:
          `Skill "${selectedSkill.summary.name}" is not user-invocable.\n\n` +
          "Choose a skill marked as invocable in `/skills`, or send a normal prompt.",
      };
    }

    if (!selectedSkill.summary.effectiveEnabled) {
      const reasons = selectedSkill.summary.gatingReasons.join(", ");
      return {
        kind: "local-response",
        responseText:
          `Skill "${selectedSkill.summary.name}" is currently unavailable.\n\n` +
          (reasons ? `Reason: ${reasons}` : "Check Agent Skills settings to re-enable it."),
      };
    }

    const invocationText = rawInvocationText.trim();
    if (
      selectedSkill.summary.commandDispatch === "tool" &&
      selectedSkill.summary.commandTool
    ) {
      return {
        kind: "tool-dispatch",
        slashCommandName,
        dispatchMode: "tool",
        toolName: selectedSkill.summary.commandTool,
        commandArgMode: selectedSkill.summary.commandArgMode ?? "raw",
        argumentText: invocationText,
        skillName: selectedSkill.summary.name,
        userText:
          invocationText ||
          `Run the "${selectedSkill.summary.commandTool}" tool for the "${selectedSkill.summary.name}" skill.`,
        runtimeSystemPrompt: [manifest, this.formatSelectedSkillPrompt(selectedSkill)]
          .filter((value) => value && value.trim().length > 0)
          .join("\n\n"),
      };
    }

    const userText =
      invocationText ||
      `Use the "${selectedSkill.summary.name}" skill for this turn. Ask one concise clarifying question if required.`;

    return {
      kind: "model",
      userText,
      slashCommandName,
      runtimeSystemPrompt: [manifest, this.formatSelectedSkillPrompt(selectedSkill)]
        .filter((value) => value && value.trim().length > 0)
        .join("\n\n"),
    };
  }

  public renderSkillsSummary(): string {
    if (this.state.skills.length === 0) {
      return [
        "No agent skills are currently available.",
        "",
        "Add a `SKILL.md` inside one of these directories and refresh Agent Skills settings:",
        ...this.renderSourceLines(),
      ].join("\n");
    }

    const lines = [
      `Available skills: ${this.state.skills.filter((skill) => skill.effectiveEnabled).length}/${this.state.skills.length}`,
      "",
    ];

    for (const skill of this.state.skills) {
      const status = skill.effectiveEnabled ? "ready" : skill.enabled ? "blocked" : "disabled";
      const flags = [
        skill.userInvocable ? "slash" : null,
        skill.modelInvocable ? "auto" : null,
        skill.commandDispatch === "tool" ? "tool-dispatch" : null,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `- ${skill.id}: ${skill.name} [${status}]${flags ? ` (${flags})` : ""}`,
      );
      if (skill.slashCommandName) {
        lines.push(`  slash: /${skill.slashCommandName}`);
      }
      if (skill.commandDispatch === "tool" && skill.commandTool) {
        lines.push(`  dispatch: tool -> ${skill.commandTool} (${skill.commandArgMode ?? "raw"})`);
      }
      if (skill.description) {
        lines.push(`  ${skill.description}`);
      }
      if (skill.gatingReasons.length > 0) {
        lines.push(`  blocked by: ${skill.gatingReasons.join(", ")}`);
      }
    }

    lines.push("");
    lines.push("Invoke a skill with `/skill <id> <task>` or its direct slash command when available.");
    return lines.join("\n");
  }

  private formatAvailableSkillsManifest(): string {
    const manifestSkills = this.state.skills.filter(
      (skill) => skill.effectiveEnabled && skill.modelInvocable,
    );
    if (manifestSkills.length === 0) {
      return "";
    }

    const lines = [
      "You can optionally use the following reusable skills when the user's request matches them.",
      "Treat them as lightweight workflows, not hard requirements.",
      "<available_skills>",
    ];

    for (const skill of manifestSkills) {
      const attributes = [
        `id="${escapeXml(skill.id)}"`,
        `name="${escapeXml(skill.name)}"`,
        `source="${skill.source}"`,
        skill.slashCommandName ? `slash_command="${escapeXml(skill.slashCommandName)}"` : "",
        skill.commandDispatch ? `dispatch="${skill.commandDispatch}"` : "",
        skill.commandArgMode ? `arg_mode="${skill.commandArgMode}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(
        `  <skill ${attributes}>`,
      );
      if (skill.description) {
        lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      }
      lines.push("  </skill>");
    }

    lines.push("</available_skills>");
    return lines.join("\n");
  }

  private formatSelectedSkillPrompt(skill: ResolvedSkill): string {
    return [
      "The user explicitly selected the following skill for this turn.",
      "Follow its instructions closely while still respecting project constraints and user intent.",
      `<selected_skill id="${escapeXml(skill.summary.id)}" name="${escapeXml(skill.summary.name)}"${skill.summary.slashCommandName ? ` slash_command="${escapeXml(skill.summary.slashCommandName)}"` : ""}${skill.summary.commandDispatch ? ` dispatch="${skill.summary.commandDispatch}"` : ""}${skill.summary.commandArgMode ? ` arg_mode="${skill.summary.commandArgMode}"` : ""}>`,
      skill.summary.description
        ? `  <description>${escapeXml(skill.summary.description)}</description>`
        : "",
      "  <instructions>",
      indentMultiline(skill.instructions, "    "),
      "  </instructions>",
      "</selected_skill>",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private renderSourceLines(): string[] {
    return [
      ...this.state.sources.workspaceDirs.map((dir) => `- workspace: ${dir}`),
      ...this.state.sources.extraDirs.map((dir) => `- extra: ${dir}`),
      ...this.state.sources.userDirs.map((dir) => `- user: ${dir}`),
      this.state.sources.bundledDir ? `- bundled: ${this.state.sources.bundledDir}` : "",
    ].filter(Boolean);
  }

  private resolveSkillRoots(config: AgentSkillsConfig): SkillRoot[] {
    const roots: SkillRoot[] = [];
    const seen = new Set<string>();
    const loadConfig = { ...DEFAULT_AGENT_SKILLS_CONFIG.load, ...(config.load ?? {}) };

    const pushRoot = (source: AgentSkillSource, directory: string | undefined) => {
      const normalized = normalizeDirectory(directory);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      roots.push({ source, directory: normalized });
    };

    if (loadConfig.includeWorkspace !== false) {
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        pushRoot("workspace", path.join(folder.uri.fsPath, "skills"));
        pushRoot("workspace", path.join(folder.uri.fsPath, ".openclaw", "skills"));
        pushRoot("workspace", path.join(folder.uri.fsPath, ".oci-ai", "skills"));
      }
    }

    if (loadConfig.includeUser !== false) {
      pushRoot("user", path.join(os.homedir(), ".openclaw", "skills"));
      pushRoot("user", path.join(os.homedir(), ".oci-ai-unofficial", "skills"));
    }

    if (loadConfig.includeBundled !== false) {
      pushRoot("bundled", path.join(this.extensionPath, "resources", "skills"));
    }

    for (const extraDir of loadConfig.extraDirs ?? []) {
      pushRoot("extra", extraDir);
    }

    return roots;
  }

  private loadSkillsFromRoot(
    root: SkillRoot,
    entries: Record<string, AgentSkillConfigEntry>,
  ): ResolvedSkill[] {
    if (!directoryExists(root.directory)) {
      return [];
    }

    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(root.directory, { withFileTypes: true });
    } catch {
      return [];
    }

    const skills: ResolvedSkill[] = [];
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }
      const directory = path.join(root.directory, child.name);
      const filePath = path.join(directory, "SKILL.md");
      if (!fileExists(filePath)) {
        continue;
      }

      const parsed = this.parseSkillFile(filePath);
      if (!parsed) {
        continue;
      }

      const skillId = normalizeSkillId(child.name);
      const metadata = extractOpenClawMetadata(parsed.frontmatter.metadata);
      const configuredEnabled = entries[skillId]?.enabled;
      const defaultEnabled = metadata.enabled !== false;
      const enabled = configuredEnabled ?? defaultEnabled;
      const gatingReasons = enabled ? this.computeGatingReasons(metadata) : [];
      const instructionsPreview = buildInstructionsPreview(parsed.instructions);
      const slashCommandName = parsed.frontmatter.userInvocable
        ? normalizeSlashCommandName(child.name)
        : undefined;

      skills.push({
        summary: {
          id: skillId,
          name: parsed.frontmatter.name?.trim() || child.name,
          description: parsed.frontmatter.description?.trim() || undefined,
          source: root.source,
          directory,
          filePath,
          homepage: parsed.frontmatter.homepage?.trim() || undefined,
          instructionsPreview,
          configuredEnabled,
          enabled,
          effectiveEnabled: enabled && gatingReasons.length === 0,
          userInvocable: Boolean(parsed.frontmatter.userInvocable),
          modelInvocable: !parsed.frontmatter.disableModelInvocation,
          slashCommandName,
          commandDispatch: parsed.frontmatter.commandDispatch,
          commandArgMode:
            parsed.frontmatter.commandDispatch === "tool"
              ? parsed.frontmatter.commandArgMode ?? "raw"
              : undefined,
          commandTool: parsed.frontmatter.commandTool?.trim() || undefined,
          gatingReasons,
        },
        instructions: parsed.instructions,
      });
    }

    return skills;
  }

  private parseSkillFile(filePath: string): ParsedSkillFile | null {
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }

    const normalized = raw.replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---\n")) {
      return {
        frontmatter: {},
        instructions: normalized.trim(),
      };
    }

    const endIndex = normalized.indexOf("\n---\n", 4);
    if (endIndex < 0) {
      return {
        frontmatter: {},
        instructions: normalized.trim(),
      };
    }

    const frontmatterText = normalized.slice(4, endIndex);
    const instructions = normalized.slice(endIndex + 5).trim();
    return {
      frontmatter: parseFrontmatter(frontmatterText),
      instructions,
    };
  }

  private computeGatingReasons(metadata: SkillOpenClawMetadata): string[] {
    const reasons: string[] = [];

    if (Array.isArray(metadata.os) && metadata.os.length > 0 && !metadata.os.includes(process.platform)) {
      reasons.push(`OS ${process.platform} not in [${metadata.os.join(", ")}]`);
    }

    for (const envName of metadata.env ?? []) {
      const value = process.env[envName];
      if (!value || !value.trim()) {
        reasons.push(`Missing env ${envName}`);
      }
    }

    for (const bin of metadata.bins ?? []) {
      if (!binaryExistsOnPath(bin)) {
        reasons.push(`Missing binary ${bin}`);
      }
    }

    return reasons;
  }

  private configureWatchers(roots: SkillRoot[], config: AgentSkillsConfig): void {
    const loadConfig = { ...DEFAULT_AGENT_SKILLS_CONFIG.load, ...(config.load ?? {}) };
    if (loadConfig.watch === false) {
      return;
    }

    const debounceMs = Math.max(100, Number(loadConfig.watchDebounceMs ?? 300) || 300);
    const watchDirs = new Set<string>();
    for (const root of roots) {
      if (directoryExists(root.directory)) {
        watchDirs.add(root.directory);
      }
    }
    for (const skill of this.resolvedSkills.values()) {
      watchDirs.add(skill.summary.directory);
    }

    for (const watchDir of watchDirs) {
      try {
        const watcher = fs.watch(watchDir, () => {
          this.scheduleRefresh(debounceMs);
        });
        this.watchers.push(watcher);
      } catch {
        // Ignore unsupported watch roots and keep the rest alive.
      }
    }
  }

  private scheduleRefresh(debounceMs: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, debounceMs);
  }

  private getConfig(): AgentSkillsConfig {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const raw = cfg.get<AgentSkillsConfig>("agentSkills", DEFAULT_AGENT_SKILLS_CONFIG);
    return {
      ...DEFAULT_AGENT_SKILLS_CONFIG,
      ...(raw ?? {}),
      entries: {
        ...(DEFAULT_AGENT_SKILLS_CONFIG.entries ?? {}),
        ...((raw?.entries ?? {}) as Record<string, AgentSkillConfigEntry>),
      },
      load: {
        ...(DEFAULT_AGENT_SKILLS_CONFIG.load ?? {}),
        ...((raw?.load ?? {}) as AgentSkillsConfig["load"]),
      },
    };
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }

  public dispose(): void {
    this.disposeWatchers();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.onDidChangeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}

function parseFrontmatter(frontmatterText: string): ParsedSkillFile["frontmatter"] {
  const frontmatter: ParsedSkillFile["frontmatter"] = {};
  const lines = frontmatterText.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const rawKey = match[1];
    const rawValue = match[2];
    const key = rawKey.toLowerCase();

    if (key === "metadata") {
      const metadataLines: string[] = [];
      if (rawValue.trim()) {
        metadataLines.push(rawValue.trim());
      }
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        metadataLines.push(lines[index].trim());
      }
      frontmatter.metadata = parseObjectValue(metadataLines.join("\n")) ?? undefined;
      continue;
    }

    const normalizedValue = stripWrappedString(rawValue.trim());
    switch (key) {
      case "name":
        frontmatter.name = normalizedValue || undefined;
        break;
      case "description":
        frontmatter.description = normalizedValue || undefined;
        break;
      case "homepage":
        frontmatter.homepage = normalizedValue || undefined;
        break;
      case "user-invocable":
        frontmatter.userInvocable = parseBooleanValue(normalizedValue);
        break;
      case "disable-model-invocation":
        frontmatter.disableModelInvocation = parseBooleanValue(normalizedValue);
        break;
      case "command-dispatch":
        frontmatter.commandDispatch = normalizedValue === "tool" ? "tool" : undefined;
        break;
      case "command-tool":
        frontmatter.commandTool = normalizedValue || undefined;
        break;
      case "command-arg-mode":
        frontmatter.commandArgMode = normalizedValue === "raw" ? "raw" : undefined;
        break;
      default:
        break;
    }
  }

  return frontmatter;
}

function parseBooleanValue(value: string): boolean {
  return /^(true|yes|1)$/i.test(value.trim());
}

function parseObjectValue(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through.
  }
  return undefined;
}

function extractOpenClawMetadata(metadata: Record<string, unknown> | undefined): SkillOpenClawMetadata {
  const candidate = metadata?.openclaw;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }
  const objectCandidate = candidate as Record<string, unknown>;
  return {
    os: normalizeStringArray(objectCandidate.os),
    env: normalizeStringArray(objectCandidate.env),
    bins: normalizeStringArray(objectCandidate.bins),
    enabled:
      typeof objectCandidate.enabled === "boolean"
        ? objectCandidate.enabled
        : undefined,
  };
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
  return next.length > 0 ? next : undefined;
}

function buildInstructionsPreview(instructions: string): string | undefined {
  const firstMeaningfulLine = instructions
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!firstMeaningfulLine) {
    return undefined;
  }
  return firstMeaningfulLine.length > 140
    ? `${firstMeaningfulLine.slice(0, 137)}...`
    : firstMeaningfulLine;
}

function binaryExistsOnPath(binaryName: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const segments = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((item) => item.toLowerCase())
      : [""];

  for (const segment of segments) {
    for (const extension of extensions) {
      const candidate = path.join(segment, process.platform === "win32" ? `${binaryName}${extension}` : binaryName);
      if (fileExists(candidate)) {
        return true;
      }
    }
  }

  return false;
}

function stripWrappedString(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function indentMultiline(value: string, indent: string): string {
  return value
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function normalizeSkillId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeSlashCommandName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeDirectory(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return path.resolve(trimmed);
}

function directoryExists(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
