import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  importSkillDirectoryFromSource,
  type AgentSkillImportResult,
  type AgentSkillImportScope,
} from "./skillImport";
import {
  installSkillWithSpec,
  isSafeBrewFormula,
  isSafeGoModule,
  isSafeNodePackageSpec,
  isSafeUvPackage,
  resolveCompatibleInstallers,
  resolvePreferredInstaller,
  type AgentSkillInstallPreferences,
  type AgentSkillInstallResult,
  type AgentSkillInstallSpec,
} from "./skillInstaller";
import {
  getSkillScanRuleCatalog,
  scanDirectoryWithSummary,
  type SkillScanFinding,
} from "../security/skillScanner";
import type {
  AgentSkillConfigEntry,
  AgentSkillInfoReport,
  AgentSkillSuppression,
  AgentSkillSuppressionScope,
  AgentSkillsCheckReport,
  AgentSkillsDiagnosticReport,
  AgentSkillsOverview,
  AgentSkillSecuritySummary,
  AgentSkillImportResult as SharedAgentSkillImportResult,
  AgentSkillsConfig,
  AgentSkillsState,
  AgentSkillSource,
  AgentSkillSummary,
} from "../shared/mcp-types";

const AGENT_SKILLS_CONFIG_KEY = "ociAi.agentSkills";
const DEFAULT_AGENT_SKILLS_CONFIG: AgentSkillsConfig = {
  entries: {},
  suppressions: [],
  load: {
    extraDirs: [],
    watch: true,
    watchDebounceMs: 300,
    includeBundled: true,
    includeWorkspace: true,
    includeUser: true,
  },
  install: {
    preferBrew: true,
    nodeManager: "npm",
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
  metadata: SkillOpenClawMetadata;
};

type SkillOpenClawMetadata = {
  always?: boolean;
  homepage?: string;
  skillKey?: string;
  primaryEnv?: string;
  os?: string[];
  requires?: {
    env?: string[];
    bins?: string[];
    anyBins?: string[];
    config?: string[];
  };
  enabled?: boolean;
  install?: AgentSkillInstallSpec[];
};

type SkillRequirementSummary = {
  os: string[];
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
};

type ActiveSkillEnvEntry = {
  baseline: string | undefined;
  value: string;
  count: number;
};

const activeSkillEnvEntries = new Map<string, ActiveSkillEnvEntry>();

const ALWAYS_BLOCKED_SKILL_ENV_PATTERNS: ReadonlyArray<RegExp> = [
  /^PATH$/i,
  /^HOME$/i,
  /^SHELL$/i,
  /^NODE_OPTIONS$/i,
  /^LD_PRELOAD$/i,
  /^DYLD_INSERT_LIBRARIES$/i,
  /^OPENSSL_CONF$/i,
  /^ELECTRON_RUN_AS_NODE$/i,
];

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
      selectedSkillId?: string;
    }
  | {
      kind: "tool-dispatch";
      slashCommandName: string;
      dispatchMode: "tool";
      toolName: string;
      commandArgMode: "raw";
      argumentText: string;
      skillName: string;
      selectedSkillId: string;
      userText: string;
      runtimeSystemPrompt?: string;
    };

export class AgentSkillService {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private watchers: fs.FSWatcher[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private scanGeneration = 0;
  private rawSecurityFindings = new Map<string, SkillScanFinding[]>();
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

  public getOverview(): AgentSkillsOverview {
    return {
      state: this.state,
      diagnostics: this.getDiagnosticReport(),
    };
  }

  public getDiagnosticReport(): AgentSkillsDiagnosticReport {
    const skills = this.state.skills;
    const ready = skills.filter((skill) => skill.effectiveEnabled);
    const disabled = skills.filter((skill) => !skill.enabled);
    const allowlistBlocked = skills.filter((skill) => skill.blockedByAllowlist);
    const missing = skills.filter(
      (skill) => skill.enabled && !skill.effectiveEnabled && !skill.blockedByAllowlist,
    );
    const installableFixes = skills.filter((skill) => isInstallFixApplicable(skill));
    const securityFlagged = skills.filter(
      (skill) => skill.security.critical > 0 || skill.security.warn > 0 || skill.security.status === "error",
    );
    const securityCritical = skills.filter((skill) => skill.security.critical > 0);
    const securitySuppressed = skills.reduce((sum, skill) => sum + skill.security.suppressed, 0);
    const suppressions = normalizeSuppressions(this.getConfig().suppressions);
    const securityRuleCounts = new Map<string, number>();
    const securityRuleSuppressedCounts = new Map<string, number>();
    const suppressionSummary = suppressions.map((suppression) =>
      computeSuppressionSummary(suppression, skills, this.rawSecurityFindings),
    );

    const issueCounts = new Map<string, number>();
    for (const skill of missing) {
      for (const label of formatMissingSummary(skill)) {
        issueCounts.set(label, (issueCounts.get(label) ?? 0) + 1);
      }
    }
    for (const skill of securityFlagged) {
      if (skill.security.status === "error") {
        issueCounts.set("security:scan-error", (issueCounts.get("security:scan-error") ?? 0) + 1);
        continue;
      }
      for (const finding of skill.security.findings) {
        const label = `security:${finding.severity}:${finding.ruleId}`;
        issueCounts.set(label, (issueCounts.get(label) ?? 0) + 1);
        securityRuleCounts.set(finding.ruleId, (securityRuleCounts.get(finding.ruleId) ?? 0) + 1);
      }
    }
    for (const [, findings] of this.rawSecurityFindings.entries()) {
      const suppressedFindings = findings.filter(
        (finding) => !applySuppressionsToFindings([finding], suppressions).length,
      )
      for (const finding of suppressedFindings) {
        securityRuleSuppressedCounts.set(
          finding.ruleId,
          (securityRuleSuppressedCounts.get(finding.ruleId) ?? 0) + 1,
        )
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        total: skills.length,
        ready: ready.length,
        missing: missing.length,
        allowlistBlocked: allowlistBlocked.length,
        disabled: disabled.length,
        installableFixes: installableFixes.length,
        securityFlagged: securityFlagged.length,
        securityCritical: securityCritical.length,
        securitySuppressed,
      },
      topIssues: Array.from(issueCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 8)
        .map(([label, count]) => ({ label, count })),
      securityRules: getSkillScanRuleCatalog().map((rule) => ({
        ruleId: rule.ruleId,
        severity: rule.severity,
        message: rule.message,
        recommendation: rule.recommendation,
      })),
      securityRuleStats: Array.from(securityRuleCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([ruleId, count]) => ({ ruleId, count })),
      securityRuleSummary: getSkillScanRuleCatalog()
        .map((rule) => ({
          ruleId: rule.ruleId,
          severity: rule.severity,
          message: rule.message,
          recommendation: rule.recommendation,
          count: securityRuleCounts.get(rule.ruleId) ?? 0,
          suppressedCount: securityRuleSuppressedCounts.get(rule.ruleId) ?? 0,
          matchingSuppressions: suppressions.filter((suppression) => suppression.ruleId === rule.ruleId),
        }))
        .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId)),
      suppressions,
      suppressionSummary,
      buckets: {
        ready: ready.map((skill) => skill.id),
        missing: missing.map((skill) => skill.id),
        allowlistBlocked: allowlistBlocked.map((skill) => skill.id),
        disabled: disabled.map((skill) => skill.id),
        installableFixes: installableFixes.map((skill) => skill.id),
        securityFlagged: securityFlagged.map((skill) => skill.id),
      },
    };
  }

  public getSkillInfoReport(rawIdentifier: string): AgentSkillInfoReport | undefined {
    const skill = this.findSkill(rawIdentifier);
    if (!skill) {
      return undefined;
    }
    return {
      generatedAt: new Date().toISOString(),
      skill: skill.summary,
    };
  }

  public getSkillsCheckReport(): AgentSkillsCheckReport {
    const diagnostics = this.getDiagnosticReport();
    return {
      generatedAt: diagnostics.generatedAt,
      diagnostics,
      sections: {
        ready: this.state.skills.filter((skill) => diagnostics.buckets.ready.includes(skill.id)),
        missing: this.state.skills.filter((skill) => diagnostics.buckets.missing.includes(skill.id)),
        allowlistBlocked: this.state.skills.filter((skill) =>
          diagnostics.buckets.allowlistBlocked.includes(skill.id),
        ),
        disabled: this.state.skills.filter((skill) => diagnostics.buckets.disabled.includes(skill.id)),
        installableFixes: this.state.skills.filter((skill) =>
          diagnostics.buckets.installableFixes.includes(skill.id),
        ),
        securityFlagged: this.state.skills.filter((skill) =>
          diagnostics.buckets.securityFlagged.includes(skill.id),
        ),
      },
    };
  }

  public async addSuppression(params: {
    scope: AgentSkillSuppressionScope
    ruleId?: string
    file?: string
    note?: string
  }): Promise<void> {
    const config = this.getConfig()
    const suppression = normalizeSuppression(params)
    if (!suppression) {
      throw new Error("A valid suppression requires ruleId, file, or both depending on scope.")
    }
    const next = normalizeSuppressions(config.suppressions)
    if (next.some((entry) => suppressionKey(entry) === suppressionKey(suppression))) {
      return
    }
    await vscode.workspace
      .getConfiguration("ociAi")
      .update(
        AGENT_SKILLS_CONFIG_KEY,
        {
          ...config,
          suppressions: [...next, suppression],
        },
        vscode.ConfigurationTarget.Global,
      )
  }

  public async removeSuppression(params: {
    scope: AgentSkillSuppressionScope
    ruleId?: string
    file?: string
  }): Promise<void> {
    const config = this.getConfig()
    const suppression = normalizeSuppression(params)
    if (!suppression) {
      return
    }
    const next = normalizeSuppressions(config.suppressions).filter(
      (entry) => suppressionKey(entry) !== suppressionKey(suppression),
    )
    await vscode.workspace
      .getConfiguration("ociAi")
      .update(
        AGENT_SKILLS_CONFIG_KEY,
        {
          ...config,
          suppressions: next,
        },
        vscode.ConfigurationTarget.Global,
      )
  }

  public async setSuppressions(suppressions: AgentSkillSuppression[]): Promise<void> {
    const config = this.getConfig()
    await vscode.workspace
      .getConfiguration("ociAi")
      .update(
        AGENT_SKILLS_CONFIG_KEY,
        {
          ...config,
          suppressions: normalizeSuppressions(suppressions),
        },
        vscode.ConfigurationTarget.Global,
      )
  }

  public refresh(): void {
    const config = this.getConfig();
    const roots = this.resolveSkillRoots(config);
    const resolvedSkills = new Map<string, ResolvedSkill>();

    for (const root of roots) {
      for (const skill of this.loadSkillsFromRoot(root, config)) {
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
    const scanGeneration = ++this.scanGeneration;
    void this.populateSecuritySummaries(scanGeneration);
    this.onDidChangeEmitter.fire();
  }

  public async toggleSkill(skillId: string, enabled: boolean): Promise<void> {
    const config = this.getConfig();
    const resolvedSkill = this.resolvedSkills.get(normalizeSkillId(skillId));
    const configKey = resolvedSkill?.summary.skillKey ?? normalizeSkillId(skillId);
    const nextEntries = {
      ...(config.entries ?? {}),
      [configKey]: {
        ...(config.entries?.[configKey] ?? {}),
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

  public async installSkill(
    skillId: string,
    installerId?: string,
    allowHighRisk = false,
  ): Promise<AgentSkillInstallResult> {
    const selectedSkill = this.resolvedSkills.get(normalizeSkillId(skillId));
    if (!selectedSkill) {
      return {
        ok: false,
        skillId,
        message: `Skill "${skillId}" was not found.`,
        stdout: "",
        stderr: "",
        code: null,
        warnings: [],
      };
    }

    const compatibleInstallers = resolveCompatibleInstallers(selectedSkill.summary.installers);
    if (compatibleInstallers.length === 0) {
      return {
        ok: false,
        skillId: selectedSkill.summary.id,
        message: `Skill "${selectedSkill.summary.name}" does not expose a compatible installer.`,
        stdout: "",
        stderr: "",
        code: null,
        warnings: [],
      };
    }

    const preferredInstaller =
      compatibleInstallers.find((installer) => installer.id === installerId) ??
      resolvePreferredInstaller(compatibleInstallers, this.getInstallPreferences());
    if (!preferredInstaller) {
      return {
        ok: false,
        skillId: selectedSkill.summary.id,
        message: `Skill "${selectedSkill.summary.name}" does not expose a compatible installer.`,
        stdout: "",
        stderr: "",
        code: null,
        warnings: [],
      };
    }

    const result = await installSkillWithSpec({
      skillId: selectedSkill.summary.id,
      spec: preferredInstaller,
      preferences: this.getInstallPreferences(),
      skillDirectory: selectedSkill.summary.directory,
      allowHighRisk,
    });
    this.refresh();
    return result;
  }

  public async importSkillFromSource(
    source: string,
    scope: AgentSkillImportScope,
    replaceExisting = false,
    allowHighRisk = false,
  ): Promise<SharedAgentSkillImportResult> {
    const result: AgentSkillImportResult = await importSkillDirectoryFromSource({
      source,
      scope,
      workspaceDir: this.resolvePrimaryWorkspaceDir(),
      replaceExisting,
      allowHighRisk,
    });
    if (result.ok) {
      this.refresh();
    }
    return result;
  }

  public async withSkillRuntimeEnvOverrides<T>(
    callback: () => Promise<T>,
    options?: {
      skillIds?: string[];
    },
  ): Promise<T> {
    const config = this.getConfig();
    const selectedSkills =
      options?.skillIds && options.skillIds.length > 0
        ? options.skillIds
            .map((skillId) => this.resolvedSkills.get(normalizeSkillId(skillId)))
            .filter((skill): skill is ResolvedSkill => Boolean(skill))
        : Array.from(this.resolvedSkills.values()).filter((skill) => skill.summary.effectiveEnabled);

    const touchedKeys: string[] = [];
    try {
      for (const skill of selectedSkills) {
        const skillConfig = config.entries?.[skill.summary.skillKey];
        if (!skillConfig) {
          continue;
        }
        this.applySkillRuntimeEnvOverrides({
          touchedKeys,
          skill,
          skillConfig,
        });
      }
      return await callback();
    } finally {
      for (let index = touchedKeys.length - 1; index >= 0; index -= 1) {
        releaseActiveSkillEnvKey(touchedKeys[index]);
      }
    }
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

    const commandMatch = text.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/i);
    if (!commandMatch) {
      return {
        kind: "model",
        userText: rawText,
        runtimeSystemPrompt: manifest,
      };
    }

    const commandName = normalizeSlashCommandName(commandMatch[1]);
    const commandArgs = (commandMatch[2] ?? "").trim();

    if (commandName === "skills") {
      return {
        kind: "local-response",
        responseText: this.resolveSkillsSlashCommand(commandArgs),
      };
    }

    if (!commandName || commandName === "commands" || commandName === "help") {
      return {
        kind: "model",
        userText: rawText,
        runtimeSystemPrompt: manifest,
      };
    }
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

  public resolveSkillsSlashCommand(rawArgs: string): string {
    const normalizedArgs = rawArgs.trim();
    if (!normalizedArgs || /^list$/i.test(normalizedArgs)) {
      return this.renderSkillsSummary();
    }
    if (/^list\s+json$/i.test(normalizedArgs)) {
      return JSON.stringify(this.getOverview(), null, 2);
    }
    if (/^(ready|eligible)$/i.test(normalizedArgs)) {
      return this.renderSkillsSummary({ readyOnly: true });
    }
    if (/^check$/i.test(normalizedArgs)) {
      return this.renderSkillsCheck();
    }
    if (/^check\s+json$/i.test(normalizedArgs)) {
      return JSON.stringify(this.getSkillsCheckReport(), null, 2);
    }
    if (/^rules$/i.test(normalizedArgs)) {
      return this.renderSkillsRules();
    }
    if (/^rules\s+json$/i.test(normalizedArgs)) {
      return JSON.stringify(this.getDiagnosticReport().securityRuleSummary, null, 2);
    }

    const infoJsonMatch = normalizedArgs.match(/^info\s+([^\s]+)\s+json$/i);
    if (infoJsonMatch) {
      const info = this.getSkillInfoReport(infoJsonMatch[1]);
      return info
        ? JSON.stringify(info, null, 2)
        : `Skill "${infoJsonMatch[1]}" was not found.\n\nRun \`/skills\` to see the currently discovered skills.`;
    }

    const infoMatch = normalizedArgs.match(/^info\s+([^\s]+)$/i);
    if (infoMatch) {
      return this.renderSkillInfo(infoMatch[1]);
    }

    return [
      "Usage: `/skills`",
      "`/skills list` - list all discovered skills",
      "`/skills list json` - dump the structured skills overview",
      "`/skills ready` - list only ready skills",
      "`/skills check` - show missing requirements and blockers",
      "`/skills check json` - dump the structured skills check report",
      "`/skills rules` - explain security scan rules and hit counts",
      "`/skills rules json` - dump the structured security rule summary",
      "`/skills info <id>` - show detailed information for one skill",
      "`/skills info <id> json` - dump structured info for one skill",
    ].join("\n");
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
    const selectedSkill = this.findSkill(rawSkillId);
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
        selectedSkillId: selectedSkill.summary.id,
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
      selectedSkillId: selectedSkill.summary.id,
      runtimeSystemPrompt: [manifest, this.formatSelectedSkillPrompt(selectedSkill)]
        .filter((value) => value && value.trim().length > 0)
        .join("\n\n"),
    };
  }

  public renderSkillsSummary(options?: { readyOnly?: boolean }): string {
    if (this.state.skills.length === 0) {
      return [
        "No agent skills are currently available.",
        "",
        "Add a `SKILL.md` inside one of these directories and refresh Agent Skills settings:",
        ...this.renderSourceLines(),
      ].join("\n");
    }

    const visibleSkills = options?.readyOnly
      ? this.state.skills.filter((skill) => skill.effectiveEnabled)
      : this.state.skills;

    if (visibleSkills.length === 0) {
      return "No ready skills are currently available.";
    }

    const lines = [
      `Available skills: ${this.state.skills.filter((skill) => skill.effectiveEnabled).length}/${this.state.skills.length}`,
      "",
    ];

    for (const skill of visibleSkills) {
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
      if (skill.skillKey && skill.skillKey !== skill.id) {
        lines.push(`  config key: ${skill.skillKey}`);
      }
      if (skill.primaryEnv) {
        lines.push(`  primary env: ${skill.primaryEnv}`);
      }
      if (skill.blockedByAllowlist) {
        lines.push("  allowlist: blocked");
      }
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
      if (skill.security.status === "error") {
        lines.push(`  security: scan-error (${skill.security.error ?? "unknown"})`);
      } else if (skill.security.critical > 0 || skill.security.warn > 0) {
        lines.push(
          `  security: ${skill.security.critical} critical, ${skill.security.warn} warn, ${skill.security.info} info`,
        );
      }
      const missingSummary = [
        ...skill.missing.os.map((value) => `os:${value}`),
        ...skill.missing.bins.map((value) => `bin:${value}`),
        ...(skill.missing.anyBins.length > 0 ? [`anyBin:${skill.missing.anyBins.join("|")}`] : []),
        ...skill.missing.env.map((value) => `env:${value}`),
        ...skill.missing.config.map((value) => `config:${value}`),
      ];
      if (missingSummary.length > 0) {
        lines.push(`  missing: ${missingSummary.join(", ")}`);
      }
    }

    lines.push("");
    lines.push("Invoke a skill with `/skill <id> <task>` or its direct slash command when available.");
    return lines.join("\n");
  }

  public renderSkillInfo(rawSkillId: string): string {
    const info = this.getSkillInfoReport(rawSkillId);
    if (!info) {
      return `Skill "${rawSkillId}" was not found.\n\nRun \`/skills\` to see the currently discovered skills.`;
    }

    const summary = info.skill;
    const lines: string[] = [];
    lines.push(`${summary.name} (${summary.id})`);
    lines.push("");
    if (summary.description) {
      lines.push(summary.description);
      lines.push("");
    }
    lines.push(`Status: ${summary.effectiveEnabled ? "ready" : summary.enabled ? "blocked" : "disabled"}`);
    lines.push(`Source: ${summary.source}`);
    lines.push(`Path: ${summary.filePath}`);
    lines.push(`Config key: ${summary.skillKey}`);
    if (summary.primaryEnv) {
      lines.push(`Primary env: ${summary.primaryEnv}`);
    }
    if (summary.homepage) {
      lines.push(`Homepage: ${summary.homepage}`);
    }
    if (summary.slashCommandName) {
      lines.push(`Slash: /${summary.slashCommandName}`);
    }
    if (summary.commandDispatch === "tool" && summary.commandTool) {
      lines.push(`Dispatch: tool -> ${summary.commandTool} (${summary.commandArgMode ?? "raw"})`);
    }
    if (summary.always) {
      lines.push("Always: true");
    }
    if (summary.blockedByAllowlist) {
      lines.push("Allowlist: blocked");
    }
    if (summary.gatingReasons.length > 0) {
      lines.push(`Blocked by: ${summary.gatingReasons.join(", ")}`);
    }
    if (summary.security.status === "error") {
      lines.push(`Security scan: error (${summary.security.error ?? "unknown"})`);
    } else {
      lines.push(
        `Security scan: ${summary.security.critical} critical / ${summary.security.warn} warn / ${summary.security.info} info`,
      );
      if (summary.security.findings.length > 0) {
        lines.push(
          `Security findings: ${summary.security.findings
            .slice(0, 5)
            .map((finding) => `${finding.severity}:${finding.ruleId}:${finding.line}`)
            .join(", ")}`,
        );
      }
    }

    const missingSummary = formatMissingSummary(summary);
    if (missingSummary.length > 0) {
      lines.push(`Missing: ${missingSummary.join(", ")}`);
    }
    if (summary.configChecks.length > 0) {
      lines.push(
        `Config checks: ${summary.configChecks
          .map((check) => `${check.satisfied ? "ok" : "missing"}:${check.path}`)
          .join(", ")}`,
      );
    }
    if (summary.installers.length > 0) {
      lines.push(
        `Installers: ${summary.installers
          .map((installer) => installer.label ?? installer.id ?? installer.kind)
          .join(" | ")}`,
      );
    }
    return lines.join("\n");
  }

  public renderSkillsCheck(): string {
    if (this.state.skills.length === 0) {
      return "No agent skills are currently available.";
    }

    const check = this.getSkillsCheckReport();
    const report = check.diagnostics;
    const {
      ready,
      disabled,
      allowlistBlocked: blockedByAllowlist,
      missing: missingRequirements,
      securityFlagged,
    } =
      check.sections;

    const lines: string[] = [];
    lines.push(`Skills check (${report.generatedAt})`);
    lines.push("");
    lines.push(`Ready: ${report.counts.ready}`);
    lines.push(`Disabled: ${report.counts.disabled}`);
    lines.push(`Blocked by allowlist: ${report.counts.allowlistBlocked}`);
    lines.push(`Missing requirements: ${report.counts.missing}`);
    lines.push(`Install-fixable: ${report.counts.installableFixes}`);
    lines.push(`Security flagged: ${report.counts.securityFlagged}`);
    lines.push(`Security critical: ${report.counts.securityCritical}`);

    if (report.topIssues.length > 0) {
      lines.push("");
      lines.push(
        `Top issues: ${report.topIssues.map((issue) => `${issue.label} (${issue.count})`).join(", ")}`,
      );
    }

    const sections: Array<{ title: string; skills: AgentSkillSummary[] }> = [
      { title: "Blocked by allowlist", skills: blockedByAllowlist },
      { title: "Missing requirements", skills: missingRequirements },
      { title: "Security flagged", skills: securityFlagged },
      { title: "Disabled", skills: disabled },
    ];

    for (const section of sections) {
      if (section.skills.length === 0) {
        continue;
      }
      lines.push("");
      lines.push(section.title);
      for (const skill of section.skills) {
        const details = [
          ...skill.gatingReasons,
          ...(skill.security.status === "error"
            ? [`security:scan-error`]
            : skill.security.findings
                .slice(0, 3)
                .map((finding) => `security:${finding.severity}:${finding.ruleId}`)),
          ...formatMissingSummary(skill),
        ];
        lines.push(`- ${skill.id}: ${details.join(" | ") || "No details"}`);
      }
    }

    if (ready.length > 0) {
      lines.push("");
      lines.push(`Ready skills: ${ready.map((skill) => skill.id).join(", ")}`);
    }

    return lines.join("\n");
  }

  public renderSkillsRules(): string {
    const diagnostics = this.getDiagnosticReport();
    if (diagnostics.securityRuleSummary.length === 0) {
      return "No security rules are registered.";
    }

    const lines: string[] = []
    lines.push("Security scan rules")
    lines.push("")
    for (const rule of diagnostics.securityRuleSummary) {
      lines.push(
        `- ${rule.ruleId} [${rule.severity}] hits=${rule.count}: ${rule.message}`,
      )
      lines.push(`  recommendation: ${rule.recommendation}`)
    }
    return lines.join("\n")
  }

  private formatAvailableSkillsManifest(): string {
    const manifestSkills = this.state.skills.filter(
      (skill) => skill.effectiveEnabled && skill.modelInvocable,
    );
    if (manifestSkills.length === 0) {
      return "";
    }

    const lines = [
      "## Skills",
      "Before replying: scan the available skills below.",
      "If the user asks what skills are available, answer directly from this list.",
      "If exactly one skill clearly matches the task, prefer that skill's workflow.",
      "If none clearly match, do not force a skill.",
      "<available_skills>",
    ];

    for (const skill of manifestSkills) {
      lines.push("  <skill>");
      lines.push(`    <id>${escapeXml(skill.id)}</id>`);
      lines.push(`    <name>${escapeXml(skill.name)}</name>`);
      if (skill.description) {
        lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      }
      lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
      lines.push(`    <source>${escapeXml(skill.source)}</source>`);
      if (skill.slashCommandName) {
        lines.push(`    <slash_command>/${escapeXml(skill.slashCommandName)}</slash_command>`);
      }
      if (skill.commandDispatch) {
        lines.push(`    <dispatch>${escapeXml(skill.commandDispatch)}</dispatch>`);
      }
      if (skill.commandArgMode) {
        lines.push(`    <arg_mode>${escapeXml(skill.commandArgMode)}</arg_mode>`);
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
        pushRoot("workspace", path.join(folder.uri.fsPath, ".agents", "skills"));
        pushRoot("workspace", path.join(folder.uri.fsPath, ".openclaw", "skills"));
        pushRoot("workspace", path.join(folder.uri.fsPath, ".oci-ai", "skills"));
        for (const extraDir of this.resolveAdjacentWorkspaceSkillDirs(folder.uri.fsPath)) {
          pushRoot("extra", extraDir);
        }
      }
    }

    if (loadConfig.includeUser !== false) {
      pushRoot("user", path.join(os.homedir(), ".agents", "skills"));
      pushRoot("user", path.join(os.homedir(), ".codex", "skills", ".system"));
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

  private resolveAdjacentWorkspaceSkillDirs(workspaceDir: string): string[] {
    const parentDir = path.dirname(workspaceDir);
    const currentName = path.basename(workspaceDir).toLowerCase();
    const candidates = [
      currentName === "openclaw" ? "" : path.join(parentDir, "openclaw", "skills"),
    ].filter(Boolean);
    return candidates.filter((directory) => directoryExists(directory));
  }

  private loadSkillsFromRoot(
    root: SkillRoot,
    config: AgentSkillsConfig,
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
      const skillKey = normalizeSkillId(metadata.skillKey?.trim() || skillId);
      const skillConfig = config.entries?.[skillKey];
      const configuredEnabled = skillConfig?.enabled;
      const defaultEnabled = metadata.enabled !== false;
      const enabled = configuredEnabled ?? defaultEnabled;
      const allowBundled = resolveBundledAllowlist(config);
      const blockedByAllowlist =
        root.source === "bundled" &&
        allowBundled !== undefined &&
        !allowBundled.includes(skillKey) &&
        !allowBundled.includes(skillId);
      const diagnostics = enabled
        ? this.computeSkillDiagnostics({
            metadata,
            skillKey,
            skillConfig,
            blockedByAllowlist,
          })
        : {
            gatingReasons: blockedByAllowlist ? ["Blocked by bundled allowlist"] : [],
            missing: {
              os: [],
              bins: [],
              anyBins: [],
              env: [],
              config: [],
            },
            configChecks: [],
          };
      const instructionsPreview = buildInstructionsPreview(parsed.instructions);
      const installers = resolveCompatibleInstallers(metadata.install);
      const preferredInstaller = resolvePreferredInstaller(installers, this.getInstallPreferences());
      const slashCommandName = parsed.frontmatter.userInvocable
        ? normalizeSlashCommandName(child.name)
        : undefined;

      skills.push({
        summary: {
          id: skillId,
          skillKey,
          name: parsed.frontmatter.name?.trim() || child.name,
          description: parsed.frontmatter.description?.trim() || undefined,
          source: root.source,
          directory,
          filePath,
          homepage: parsed.frontmatter.homepage?.trim() || metadata.homepage?.trim() || undefined,
          instructionsPreview,
          configuredEnabled,
          enabled,
          effectiveEnabled: enabled && diagnostics.gatingReasons.length === 0,
          userInvocable: Boolean(parsed.frontmatter.userInvocable),
          modelInvocable: !parsed.frontmatter.disableModelInvocation,
          slashCommandName,
          commandDispatch: parsed.frontmatter.commandDispatch,
          commandArgMode:
            parsed.frontmatter.commandDispatch === "tool"
              ? parsed.frontmatter.commandArgMode ?? "raw"
              : undefined,
          commandTool: parsed.frontmatter.commandTool?.trim() || undefined,
          primaryEnv: metadata.primaryEnv?.trim() || undefined,
          always: metadata.always === true,
          blockedByAllowlist,
          installers,
          preferredInstallerId: preferredInstaller?.id,
          security: createPendingSecuritySummary(),
          missing: diagnostics.missing,
          configChecks: diagnostics.configChecks,
          gatingReasons: diagnostics.gatingReasons,
        },
        instructions: parsed.instructions,
        metadata,
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

  private computeSkillDiagnostics(params: {
    metadata: SkillOpenClawMetadata;
    skillKey: string;
    skillConfig?: AgentSkillConfigEntry;
    blockedByAllowlist?: boolean;
  }): {
    gatingReasons: string[];
    missing: SkillRequirementSummary;
    configChecks: Array<{ path: string; satisfied: boolean }>;
  } {
    const { metadata, skillConfig, blockedByAllowlist } = params;
    const reasons: string[] = [];
    const missing: SkillRequirementSummary = {
      os: [],
      bins: [],
      anyBins: [],
      env: [],
      config: [],
    };
    const configChecks: Array<{ path: string; satisfied: boolean }> = [];

    if (
      Array.isArray(metadata.os) &&
      metadata.os.length > 0 &&
      !metadata.os.includes(process.platform)
    ) {
      reasons.push(`OS ${process.platform} not in [${metadata.os.join(", ")}]`);
      missing.os.push(...metadata.os);
    }

    if (blockedByAllowlist) {
      reasons.push("Blocked by bundled allowlist");
    }

    if (metadata.always === true) {
      return { gatingReasons: reasons, missing, configChecks };
    }

    for (const envName of metadata.requires?.env ?? []) {
      const value =
        process.env[envName] ||
        skillConfig?.env?.[envName] ||
        (skillConfig?.apiKey && metadata.primaryEnv === envName ? skillConfig.apiKey : undefined);
      if (!value || !value.trim()) {
        reasons.push(`Missing env ${envName}`);
        missing.env.push(envName);
      }
    }

    for (const bin of metadata.requires?.bins ?? []) {
      if (!binaryExistsOnPath(bin)) {
        reasons.push(`Missing binary ${bin}`);
        missing.bins.push(bin);
      }
    }

    const anyBins = metadata.requires?.anyBins ?? [];
    if (anyBins.length > 0 && !anyBins.some((bin) => binaryExistsOnPath(bin))) {
      reasons.push(`Missing one of binaries [${anyBins.join(", ")}]`);
      missing.anyBins.push(...anyBins);
    }

    for (const configPath of metadata.requires?.config ?? []) {
      const satisfied = this.isConfigPathTruthy(configPath, skillConfig);
      configChecks.push({ path: configPath, satisfied });
      if (!satisfied) {
        reasons.push(`Missing config ${configPath}`);
        missing.config.push(configPath);
      }
    }

    return {
      gatingReasons: dedupeStrings(reasons),
      missing: {
        os: dedupeStrings(missing.os),
        bins: dedupeStrings(missing.bins),
        anyBins: dedupeStrings(missing.anyBins),
        env: dedupeStrings(missing.env),
        config: dedupeStrings(missing.config),
      },
      configChecks,
    };
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
      install: {
        ...(DEFAULT_AGENT_SKILLS_CONFIG.install ?? {}),
        ...((raw?.install ?? {}) as AgentSkillsConfig["install"]),
      },
      suppressions: normalizeSuppressions(raw?.suppressions),
    };
  }

  private getInstallPreferences(): AgentSkillInstallPreferences {
    const install = this.getConfig().install;
    return {
      preferBrew: install?.preferBrew ?? true,
      nodeManager: install?.nodeManager ?? "npm",
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

  private resolvePrimaryWorkspaceDir(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private findSkill(rawIdentifier: string): ResolvedSkill | undefined {
    const normalized = normalizeSkillId(rawIdentifier);
    if (!normalized) {
      return undefined;
    }

    const exactId = this.resolvedSkills.get(normalized);
    if (exactId) {
      return exactId;
    }

    return Array.from(this.resolvedSkills.values()).find((skill) => {
      return (
        skill.summary.skillKey === normalized ||
        normalizeSkillId(skill.summary.name) === normalized ||
        skill.summary.slashCommandName === normalized
      );
    });
  }

  private isConfigPathTruthy(configPath: string, skillConfig?: AgentSkillConfigEntry): boolean {
    const normalizedPath = configPath.trim();
    if (!normalizedPath) {
      return false;
    }

    const localConfigValue = resolveObjectPath(skillConfig?.config, normalizedPath);
    if (isTruthyConfigValue(localConfigValue)) {
      return true;
    }

    const cfg = vscode.workspace.getConfiguration("ociAi");
    const aliasValue = resolveConfigAlias(cfg, normalizedPath);
    if (aliasValue !== undefined) {
      return isTruthyConfigValue(aliasValue);
    }

    return isTruthyConfigValue(cfg.get(normalizedPath));
  }

  private applySkillRuntimeEnvOverrides(params: {
    touchedKeys: string[];
    skill: ResolvedSkill;
    skillConfig: AgentSkillConfigEntry;
  }): void {
    const { touchedKeys, skill, skillConfig } = params;
    const pendingOverrides: Record<string, string> = {};
    const allowedSensitiveKeys = new Set<string>();

    if (skill.summary.primaryEnv) {
      allowedSensitiveKeys.add(skill.summary.primaryEnv);
    }
    for (const envName of skill.metadata.requires?.env ?? []) {
      const trimmed = envName.trim();
      if (trimmed) {
        allowedSensitiveKeys.add(trimmed);
      }
    }

    for (const envName of skill.summary.primaryEnv ? [skill.summary.primaryEnv] : []) {
      const apiKey = skillConfig.apiKey?.trim();
      if (envName && apiKey) {
        pendingOverrides[envName] = apiKey;
      }
    }

    for (const [rawKey, rawValue] of Object.entries(skillConfig.env ?? {})) {
      const envKey = rawKey.trim();
      const envValue = String(rawValue ?? "").trim();
      if (!envKey || !envValue) {
        continue;
      }
      pendingOverrides[envKey] = envValue;
      if (skill.summary.primaryEnv === envKey) {
        allowedSensitiveKeys.add(envKey);
      }
    }

    for (const [envKey, envValue] of Object.entries(
      sanitizeSkillEnvOverrides(pendingOverrides, allowedSensitiveKeys),
    )) {
      if (acquireActiveSkillEnvKey(envKey, envValue)) {
        touchedKeys.push(envKey);
      }
    }
  }

  private async populateSecuritySummaries(scanGeneration: number): Promise<void> {
    const suppressions = normalizeSuppressions(this.getConfig().suppressions)
    const entries = Array.from(this.resolvedSkills.entries())
    const updates = await Promise.all(
      entries.map(async ([skillId, skill]) => {
        try {
          const summary = await scanDirectoryWithSummary(skill.summary.directory)
          this.rawSecurityFindings.set(skillId, summary.findings)
          const filteredFindings = applySuppressionsToFindings(summary.findings, suppressions)
          return [
            skillId,
            {
              status: "ready" as const,
              scannedFiles: summary.scannedFiles,
              critical: filteredFindings.filter((finding) => finding.severity === "critical").length,
              warn: filteredFindings.filter((finding) => finding.severity === "warn").length,
              info: filteredFindings.filter((finding) => finding.severity === "info").length,
              suppressed: summary.findings.length - filteredFindings.length,
              findings: filteredFindings.map((finding) => ({
                ruleId: finding.ruleId,
                severity: finding.severity,
                file: finding.file,
                line: finding.line,
                message: finding.message,
                evidence: finding.evidence,
                recommendation: finding.recommendation,
              })),
            } satisfies AgentSkillSecuritySummary,
          ] as const
        } catch (error) {
          this.rawSecurityFindings.delete(skillId)
          return [
            skillId,
            {
              status: "error" as const,
              scannedFiles: 0,
              critical: 0,
              warn: 0,
              info: 0,
              suppressed: 0,
              findings: [],
              error: error instanceof Error ? error.message : String(error),
            } satisfies AgentSkillSecuritySummary,
          ] as const
        }
      }),
    )

    if (scanGeneration !== this.scanGeneration) {
      return
    }

    let changed = false
    this.state = {
      ...this.state,
      skills: this.state.skills.map((skill) => {
        const nextSecurity = updates.find(([skillId]) => skillId === skill.id)?.[1]
        if (!nextSecurity) {
          return skill
        }
        if (JSON.stringify(skill.security) === JSON.stringify(nextSecurity)) {
          return skill
        }
        changed = true
        return {
          ...skill,
          security: nextSecurity,
        }
      }),
    }
    if (changed) {
      this.onDidChangeEmitter.fire()
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
  const requiresCandidate =
    objectCandidate.requires && typeof objectCandidate.requires === "object" && !Array.isArray(objectCandidate.requires)
      ? (objectCandidate.requires as Record<string, unknown>)
      : undefined;
  const installCandidate = Array.isArray(objectCandidate.install)
    ? objectCandidate.install
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
        .flatMap((item) => {
          const kind = normalizeInstallKind(item.kind);
          if (!kind) {
            return [];
          }
          return [
            {
              id: normalizeOptionalString(item.id),
              kind,
              label: normalizeOptionalString(item.label),
              bins: normalizeStringArray(item.bins),
              os: normalizeStringArray(item.os),
              formula: normalizeInstallFormula(item.formula),
              package: normalizeInstallPackage(item.package, kind),
              module: normalizeInstallModule(item.module),
              url: normalizeInstallUrl(item.url),
              archive: normalizeArchiveType(item.archive),
              extract: typeof item.extract === "boolean" ? item.extract : undefined,
              stripComponents:
                typeof item.stripComponents === "number" && Number.isFinite(item.stripComponents)
                  ? item.stripComponents
                  : undefined,
              targetDir: normalizeOptionalString(item.targetDir),
            } satisfies AgentSkillInstallSpec,
          ];
        })
    : undefined;

  return {
    always:
      typeof objectCandidate.always === "boolean"
        ? objectCandidate.always
        : undefined,
    homepage: normalizeOptionalString(objectCandidate.homepage),
    skillKey: normalizeOptionalString(objectCandidate.skillKey),
    primaryEnv: normalizeOptionalString(objectCandidate.primaryEnv),
    os: normalizeStringArray(objectCandidate.os),
    requires: requiresCandidate
      ? {
          env: normalizeStringArray(requiresCandidate.env),
          bins: normalizeStringArray(requiresCandidate.bins),
          anyBins: normalizeStringArray(requiresCandidate.anyBins),
          config: normalizeStringArray(requiresCandidate.config),
        }
      : undefined,
    enabled:
      typeof objectCandidate.enabled === "boolean"
        ? objectCandidate.enabled
        : undefined,
    install: installCandidate,
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

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeInstallKind(value: unknown): AgentSkillInstallSpec["kind"] | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized === "brew" ||
    normalized === "node" ||
    normalized === "go" ||
    normalized === "uv" ||
    normalized === "download"
    ? normalized
    : undefined;
}

function normalizeArchiveType(value: unknown): AgentSkillInstallSpec["archive"] | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized === "zip" || normalized === "tar.gz" || normalized === "tar.bz2"
    ? normalized
    : undefined;
}

function normalizeInstallFormula(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return isSafeBrewFormula(normalized) ? normalized : undefined;
}

function normalizeInstallPackage(
  value: unknown,
  kind: AgentSkillInstallSpec["kind"],
): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }
  if (kind === "uv") {
    return isSafeUvPackage(normalized) ? normalized : undefined;
  }
  return isSafeNodePackageSpec(normalized) ? normalized : undefined;
}

function normalizeInstallModule(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return isSafeGoModule(normalized) ? normalized : undefined;
}

function normalizeInstallUrl(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }
  try {
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
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

function resolveObjectPath(
  value: Record<string, unknown> | undefined,
  pathStr: string,
): unknown {
  const parts = pathStr.split(".").filter(Boolean);
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isTruthyConfigValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function resolveConfigAlias(
  cfg: vscode.WorkspaceConfiguration,
  configPath: string,
): unknown {
  switch (configPath) {
    case "browser.enabled":
    case "browser.evaluateEnabled":
      return cfg.get("agentEnabledTools.browserAction");
    default:
      return undefined;
  }
}

function resolveBundledAllowlist(config?: AgentSkillsConfig): string[] | undefined {
  const values = Array.isArray(config?.allowBundled)
    ? config.allowBundled.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)
    : [];
  return values.length > 0 ? Array.from(new Set(values)) : undefined;
}

function normalizeSuppression(
  input: Partial<AgentSkillSuppression> | undefined,
): AgentSkillSuppression | undefined {
  const scope = String(input?.scope ?? "").trim() as AgentSkillSuppressionScope
  const ruleId = normalizeOptionalString(input?.ruleId)
  const file = normalizeSuppressionFile(input?.file)
  const note = normalizeOptionalString(input?.note)
  const createdAt =
    normalizeOptionalString(input?.createdAt) ??
    (scope === "rule" || scope === "file" || scope === "rule-file" ? new Date().toISOString() : undefined)

  if (scope === "rule") {
    return ruleId ? { scope, ruleId, note, createdAt } : undefined
  }
  if (scope === "file") {
    return file ? { scope, file, note, createdAt } : undefined
  }
  if (scope === "rule-file") {
    return ruleId && file ? { scope, ruleId, file, note, createdAt } : undefined
  }
  return undefined
}

function normalizeSuppressions(input: unknown): AgentSkillSuppression[] {
  if (!Array.isArray(input)) {
    return []
  }
  const next: AgentSkillSuppression[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== "object") {
      continue
    }
    const normalized = normalizeSuppression(entry as Partial<AgentSkillSuppression>)
    if (!normalized) {
      continue
    }
    if (next.some((existing) => suppressionKey(existing) === suppressionKey(normalized))) {
      continue
    }
    next.push(normalized)
  }
  return next
}

function normalizeSuppressionFile(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value)
  if (!normalized) {
    return undefined
  }
  return path.resolve(normalized)
}

function suppressionKey(suppression: AgentSkillSuppression): string {
  return `${suppression.scope}::${suppression.ruleId ?? ""}::${suppression.file ?? ""}`
}

function applySuppressionsToFindings(
  findings: SkillScanFinding[],
  suppressions: AgentSkillSuppression[],
): SkillScanFinding[] {
  if (suppressions.length === 0) {
    return findings
  }
  return findings.filter((finding) => {
    const file = normalizeSuppressionFile(finding.file)
    return !suppressions.some((suppression) => {
      if (suppression.scope === "rule") {
        return suppression.ruleId === finding.ruleId
      }
      if (suppression.scope === "file") {
        return suppression.file === file
      }
      return suppression.ruleId === finding.ruleId && suppression.file === file
    })
  })
}

function computeSuppressionSummary(
  suppression: AgentSkillSuppression,
  skills: AgentSkillSummary[],
  rawFindings: Map<string, SkillScanFinding[]>,
) {
  let affectedFindings = 0
  const affectedSkills = new Set<string>()

  for (const skill of skills) {
    const findings = rawFindings.get(skill.id) ?? []
    const remaining = applySuppressionsToFindings(findings, [suppression])
    const suppressedCount = findings.length - remaining.length
    if (suppressedCount > 0) {
      affectedFindings += suppressedCount
      affectedSkills.add(skill.id)
    }
  }

  return {
    suppression,
    affectedFindings,
    affectedSkills: Array.from(affectedSkills).sort(),
  }
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function formatMissingSummary(skill: AgentSkillSummary): string[] {
  return [
    ...skill.missing.os.map((value) => `os:${value}`),
    ...skill.missing.bins.map((value) => `bin:${value}`),
    ...(skill.missing.anyBins.length > 0 ? [`anyBin:${skill.missing.anyBins.join("|")}`] : []),
    ...skill.missing.env.map((value) => `env:${value}`),
    ...skill.missing.config.map((value) => `config:${value}`),
  ];
}

function isInstallFixApplicable(skill: AgentSkillSummary): boolean {
  if (!skill.enabled || skill.effectiveEnabled || skill.blockedByAllowlist) {
    return false;
  }
  if (skill.installers.length === 0) {
    return false;
  }
  return skill.missing.bins.length > 0 || skill.missing.anyBins.length > 0;
}

function createPendingSecuritySummary(): AgentSkillSecuritySummary {
  return {
    status: "pending",
    scannedFiles: 0,
    critical: 0,
    warn: 0,
    info: 0,
    suppressed: 0,
    findings: [],
  };
}

function sanitizeSkillEnvOverrides(
  overrides: Record<string, string>,
  allowedSensitiveKeys: Set<string>,
): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(overrides)) {
    const key = rawKey.trim();
    const value = rawValue;
    if (!key || !isSafeEnvVarKey(key) || value.includes("\u0000")) {
      continue;
    }
    if (isAlwaysBlockedSkillEnvKey(key)) {
      continue;
    }
    if (looksSensitiveEnvKey(key) && !allowedSensitiveKeys.has(key)) {
      continue;
    }
    allowed[key] = value;
  }
  return allowed;
}

function acquireActiveSkillEnvKey(key: string, value: string): boolean {
  const active = activeSkillEnvEntries.get(key);
  if (active) {
    active.count += 1;
    if (process.env[key] === undefined) {
      process.env[key] = active.value;
    }
    return true;
  }
  if (process.env[key] !== undefined) {
    return false;
  }
  activeSkillEnvEntries.set(key, {
    baseline: process.env[key],
    value,
    count: 1,
  });
  process.env[key] = value;
  return true;
}

function releaseActiveSkillEnvKey(key: string): void {
  const active = activeSkillEnvEntries.get(key);
  if (!active) {
    return;
  }
  active.count -= 1;
  if (active.count > 0) {
    if (process.env[key] === undefined) {
      process.env[key] = active.value;
    }
    return;
  }
  activeSkillEnvEntries.delete(key);
  if (active.baseline === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = active.baseline;
  }
}

function isSafeEnvVarKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function isAlwaysBlockedSkillEnvKey(key: string): boolean {
  return ALWAYS_BLOCKED_SKILL_ENV_PATTERNS.some((pattern) => pattern.test(key));
}

function looksSensitiveEnvKey(key: string): boolean {
  return /(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH)/i.test(key);
}
