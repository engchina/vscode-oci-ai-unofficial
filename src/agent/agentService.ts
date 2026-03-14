import * as vscode from "vscode";
import type {
  AgentSettings,
  AgentMode,
  AgentAutoApprovalSettings,
  AgentEnabledTools,
  ToolApprovalResponse,
} from "../shared/mcp-types";

const AGENT_MODE_KEY = "ociAi.agentMode";
const AGENT_AUTO_APPROVAL_KEY = "ociAi.agentAutoApproval";
const AGENT_MAX_AUTO_ACTIONS_KEY = "ociAi.agentMaxAutoActions";
const AGENT_ENABLED_TOOLS_KEY = "ociAi.agentEnabledTools";

const DEFAULT_AUTO_APPROVAL: AgentAutoApprovalSettings = {
  readFiles: true,
  writeFiles: false,
  executeCommands: false,
  webSearch: true,
  mcpTools: false,
};

const DEFAULT_ENABLED_TOOLS: AgentEnabledTools = {
  readFile: true,
  writeFile: true,
  executeCommand: true,
  webSearch: true,
  browserAction: false,
};

/**
 * AgentService manages agent mode, tool approval, and tool execution settings.
 */
export class AgentService {
  private pendingApprovals: Map<string, {
    resolve: (response: ToolApprovalResponse) => void;
  }> = new Map();

  private onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  /** Get current agent settings */
  public getSettings(): AgentSettings {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    return {
      mode: cfg.get<AgentMode>("agentMode", "chat"),
      autoApproval: cfg.get<AgentAutoApprovalSettings>("agentAutoApproval", DEFAULT_AUTO_APPROVAL),
      maxAutoActions: cfg.get<number>("agentMaxAutoActions", 10),
      enabledTools: cfg.get<AgentEnabledTools>("agentEnabledTools", DEFAULT_ENABLED_TOOLS),
    };
  }

  /** Save agent settings */
  public async saveSettings(settings: AgentSettings): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    await Promise.all([
      cfg.update("agentMode", settings.mode, vscode.ConfigurationTarget.Global),
      cfg.update("agentAutoApproval", settings.autoApproval, vscode.ConfigurationTarget.Global),
      cfg.update("agentMaxAutoActions", settings.maxAutoActions, vscode.ConfigurationTarget.Global),
      cfg.update("agentEnabledTools", settings.enabledTools, vscode.ConfigurationTarget.Global),
    ]);
    this.onDidChangeEmitter.fire();
  }

  /** Check if a tool should be auto-approved */
  public shouldAutoApprove(toolName: string, serverName?: string): boolean {
    const settings = this.getSettings();
    if (settings.mode !== "agent") return false;

    // MCP tools
    if (serverName) {
      return settings.autoApproval.mcpTools;
    }

    // Built-in tools
    switch (toolName) {
      case "readFile":
        return settings.autoApproval.readFiles;
      case "writeFile":
        return settings.autoApproval.writeFiles;
      case "executeCommand":
        return settings.autoApproval.executeCommands;
      case "webSearch":
        return settings.autoApproval.webSearch;
      default:
        return false;
    }
  }

  /** Check if a tool is enabled */
  public isToolEnabled(toolName: string): boolean {
    const settings = this.getSettings();
    const key = toolName as keyof AgentEnabledTools;
    return key in settings.enabledTools ? settings.enabledTools[key] : true;
  }

  /** Request approval for a tool call (returns promise resolved by webview) */
  public requestApproval(callId: string, signal?: AbortSignal): Promise<ToolApprovalResponse> {
    return new Promise((resolve) => {
      const finish = (response: ToolApprovalResponse) => {
        signal?.removeEventListener("abort", handleAbort);
        resolve(response);
      };

      const handleAbort = () => {
        if (this.pendingApprovals.delete(callId)) {
          finish({ callId, approved: false });
        }
      };

      if (signal?.aborted) {
        finish({ callId, approved: false });
        return;
      }

      signal?.addEventListener("abort", handleAbort, { once: true });
      this.pendingApprovals.set(callId, { resolve: finish });
    });
  }

  /** Resolve a pending approval */
  public resolveApproval(response: ToolApprovalResponse): void {
    const pending = this.pendingApprovals.get(response.callId);
    if (pending) {
      pending.resolve(response);
      this.pendingApprovals.delete(response.callId);
    }
  }

  /** Dispose */
  public dispose(): void {
    this.onDidChangeEmitter.dispose();
    // Reject all pending approvals
    for (const [, pending] of this.pendingApprovals) {
      pending.resolve({ callId: "", approved: false });
    }
    this.pendingApprovals.clear();
  }
}
