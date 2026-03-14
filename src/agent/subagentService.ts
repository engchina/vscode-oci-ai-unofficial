import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { ChatMessage } from "../oci/genAiService";

export type SubagentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type SubagentLogKind = "lifecycle" | "user" | "assistant" | "steer" | "tool" | "approval" | "error";

export interface SubagentLogEntry {
  timestamp: string;
  kind: SubagentLogKind;
  message: string;
}

export interface SubagentRun {
  id: string;
  shortId: string;
  agentId: string;
  task: string;
  modelName?: string;
  status: SubagentRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  transcriptPath: string;
  parentContextSummary: string;
  messages: ChatMessage[];
  steeringNotes: string[];
  logs: SubagentLogEntry[];
  resultText?: string;
  errorText?: string;
  runtimeMs?: number;
  generation: number;
  completedGeneration?: number;
  announcedGeneration?: number;
  processing: boolean;
  abortController?: AbortController;
}

export class SubagentService {
  private readonly runs = new Map<string, SubagentRun>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  public createRun(options: {
    id: string;
    agentId: string;
    task: string;
    modelName?: string;
    parentContextSummary: string;
  }): SubagentRun {
    const now = new Date().toISOString();
    const run: SubagentRun = {
      id: options.id,
      shortId: options.id.slice(0, 8),
      agentId: options.agentId.trim() || "main",
      task: options.task.trim(),
      modelName: options.modelName?.trim() || undefined,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      transcriptPath: this.buildTranscriptPath(options.id),
      parentContextSummary: options.parentContextSummary.trim(),
      messages: [{ role: "user", text: options.task.trim() }],
      steeringNotes: [],
      logs: [],
      generation: 1,
      processing: false,
    };
    this.runs.set(run.id, run);
    this.appendLog(run, "lifecycle", `Spawned subagent for agent "${run.agentId}".`);
    this.persistRun(run);
    return run;
  }

  public listRuns(): SubagentRun[] {
    return Array.from(this.runs.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public getRun(id: string): SubagentRun | undefined {
    return this.runs.get(id);
  }

  public getTranscript(run: SubagentRun): string {
    return renderRunTranscript(run);
  }

  public resolveRunToken(token: string): { run?: SubagentRun; error?: string } {
    const normalized = token.trim();
    if (!normalized) {
      return { error: "A subagent id or #index is required." };
    }

    if (normalized === "all") {
      return { error: 'Use "all" only with kill.' };
    }

    if (normalized.startsWith("#")) {
      const index = Number(normalized.slice(1));
      if (!Number.isInteger(index) || index < 1) {
        return { error: `Invalid subagent index: ${normalized}` };
      }
      const run = this.listRuns()[index - 1];
      if (!run) {
        return { error: `No subagent matched ${normalized}.` };
      }
      return { run };
    }

    const exact = this.runs.get(normalized);
    if (exact) {
      return { run: exact };
    }

    const prefixMatches = this.listRuns().filter(
      (run) => run.id.startsWith(normalized) || run.shortId.startsWith(normalized),
    );
    if (prefixMatches.length === 1) {
      return { run: prefixMatches[0] };
    }
    if (prefixMatches.length > 1) {
      return { error: `Subagent token "${normalized}" matched multiple runs.` };
    }
    return { error: `No subagent matched "${normalized}".` };
  }

  public queueUserMessage(run: SubagentRun, message: string): void {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    run.messages.push({ role: "user", text: trimmed });
    run.generation += 1;
    run.updatedAt = new Date().toISOString();
    this.appendLog(run, "user", trimmed);
    this.requestRestart(run);
    this.persistRun(run);
  }

  public queueSteering(run: SubagentRun, message: string): void {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    run.steeringNotes.push(trimmed);
    run.generation += 1;
    run.updatedAt = new Date().toISOString();
    this.appendLog(run, "steer", trimmed);
    this.requestRestart(run);
    this.persistRun(run);
  }

  public beginRun(run: SubagentRun): AbortController {
    const now = new Date().toISOString();
    const abortController = new AbortController();
    run.abortController = abortController;
    run.processing = true;
    run.status = "running";
    run.startedAt = run.startedAt ?? now;
    run.updatedAt = now;
    this.appendLog(run, "lifecycle", run.completedGeneration ? "Resumed subagent run." : "Started subagent run.");
    this.persistRun(run);
    return abortController;
  }

  public clearActiveRun(run: SubagentRun, abortController: AbortController): void {
    if (run.abortController === abortController) {
      run.abortController = undefined;
    }
    run.processing = false;
    run.updatedAt = new Date().toISOString();
    this.persistRun(run);
  }

  public markCompleted(run: SubagentRun, assistantText: string, runtimeMs: number): void {
    const now = new Date().toISOString();
    const trimmed = assistantText.trim();
    run.status = "completed";
    run.processing = false;
    run.abortController = undefined;
    run.updatedAt = now;
    run.finishedAt = now;
    run.runtimeMs = runtimeMs;
    run.resultText = trimmed;
    run.errorText = undefined;
    run.completedGeneration = run.generation;
    if (trimmed) {
      run.messages.push({ role: "model", text: trimmed });
      this.appendLog(run, "assistant", trimmed);
    } else {
      this.appendLog(run, "assistant", "(empty result)");
    }
    this.persistRun(run);
  }

  public markFailed(run: SubagentRun, errorText: string, runtimeMs: number): void {
    const now = new Date().toISOString();
    run.status = "failed";
    run.processing = false;
    run.abortController = undefined;
    run.updatedAt = now;
    run.finishedAt = now;
    run.runtimeMs = runtimeMs;
    run.errorText = errorText.trim();
    this.appendLog(run, "error", run.errorText);
    this.persistRun(run);
  }

  public cancelRun(run: SubagentRun, reason = "Cancelled by user."): void {
    run.status = "cancelled";
    run.processing = false;
    run.updatedAt = new Date().toISOString();
    run.finishedAt = run.updatedAt;
    run.errorText = reason;
    this.appendLog(run, "lifecycle", reason);
    run.abortController?.abort();
    run.abortController = undefined;
    this.persistRun(run);
  }

  public markAnnounced(run: SubagentRun): void {
    run.announcedGeneration = run.completedGeneration;
    run.updatedAt = new Date().toISOString();
    this.persistRun(run);
  }

  public appendLog(run: SubagentRun, kind: SubagentLogKind, message: string): void {
    run.logs.push({
      timestamp: new Date().toISOString(),
      kind,
      message: message.trim(),
    });
    if (run.logs.length > 200) {
      run.logs.splice(0, run.logs.length - 200);
    }
    run.updatedAt = new Date().toISOString();
    this.persistRun(run);
  }

  private requestRestart(run: SubagentRun): void {
    if (run.abortController) {
      run.abortController.abort();
    }
    if (run.status !== "cancelled") {
      run.status = "queued";
    }
  }

  private buildTranscriptPath(id: string): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const directory = workspaceRoot
      ? path.join(workspaceRoot, ".oci-ai", "subagents")
      : path.join(os.tmpdir(), "oci-ai-subagents");
    return path.join(directory, `subagent-${id}.md`);
  }

  private persistRun(run: SubagentRun): void {
    const directory = path.dirname(run.transcriptPath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(run.transcriptPath, renderRunTranscript(run), "utf8");
    this.onDidChangeEmitter.fire();
  }
}

function renderRunTranscript(run: SubagentRun): string {
  const lines = [
    `# Subagent ${run.shortId}`,
    "",
    `- id: ${run.id}`,
    `- agent: ${run.agentId}`,
    `- status: ${run.status}`,
    `- createdAt: ${run.createdAt}`,
    `- updatedAt: ${run.updatedAt}`,
    `- startedAt: ${run.startedAt ?? "-"}`,
    `- finishedAt: ${run.finishedAt ?? "-"}`,
    `- model: ${run.modelName ?? "(default)"}`,
    `- runtimeMs: ${typeof run.runtimeMs === "number" ? run.runtimeMs : "-"}`,
    "",
    "## Task",
    "",
    run.task,
    "",
  ];

  if (run.parentContextSummary) {
    lines.push("## Parent Context");
    lines.push("");
    lines.push(run.parentContextSummary);
    lines.push("");
  }

  if (run.steeringNotes.length > 0) {
    lines.push("## Steering Notes");
    lines.push("");
    for (const note of run.steeringNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  lines.push("## Transcript");
  lines.push("");
  if (run.messages.length === 0) {
    lines.push("(empty)");
    lines.push("");
  } else {
    for (const message of run.messages) {
      lines.push(`### ${message.role === "user" ? "User" : "Assistant"}`);
      lines.push("");
      lines.push(message.text || "(empty)");
      lines.push("");
    }
  }

  if (run.logs.length > 0) {
    lines.push("## Logs");
    lines.push("");
    for (const entry of run.logs) {
      lines.push(`- [${entry.timestamp}] ${entry.kind}: ${entry.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
