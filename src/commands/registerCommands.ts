import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { GenAiService } from "../oci/genAiService";
import { OciService } from "../oci/ociService";

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: {
    authManager: AuthManager;
    ociService: OciService;
    genAiService: GenAiService;
    refreshCompute: () => void;
    refreshAdb: () => void;
  }
): void {
  const { authManager, refreshCompute, refreshAdb } = dependencies;

  context.subscriptions.push(
    vscode.commands.registerCommand("ociAi.refreshCompute", refreshCompute),
    vscode.commands.registerCommand("ociAi.refreshAdb", refreshAdb),
    vscode.commands.registerCommand("ociAi.auth.configureProfile", async () => {
      await authManager.configureProfileInteractive();
      refreshCompute();
      refreshAdb();
    }),
    vscode.commands.registerCommand("ociAi.auth.configureApiKey", async () => {
      await authManager.configureApiKeyInteractive();
    }),
    // Open settings: reveal OCI Settings view
    vscode.commands.registerCommand("ociAi.openSettings", async () => {
      await vscode.commands.executeCommand("ociAi.settingsView.focus");
    }),
    // Open chat: reveal Generative AI Chat view
    vscode.commands.registerCommand("ociAi.openChat", async () => {
      await vscode.commands.executeCommand("ociAi.chatView.focus");
    }),
    // Start/Stop commands are handled directly in the webview; these are no-ops for compatibility
    vscode.commands.registerCommand("ociAi.compute.start", () => {}),
    vscode.commands.registerCommand("ociAi.compute.stop", () => {}),
    vscode.commands.registerCommand("ociAi.adb.start", () => {}),
    vscode.commands.registerCommand("ociAi.adb.stop", () => {}),
  );
}
