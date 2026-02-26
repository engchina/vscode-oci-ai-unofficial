import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { registerCommands } from "./commands/registerCommands";
import { Controller } from "./controller/index";
import { OciClientFactory } from "./oci/clientFactory";
import { AdbSqlService } from "./oci/adbSqlService";
import { GenAiService } from "./oci/genAiService";
import { OciService } from "./oci/ociService";
import { OciWebviewProvider } from "./webview/OciWebviewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const authManager = new AuthManager(context);
  const factory = new OciClientFactory(authManager);
  const ociService = new OciService(factory);
  const genAiService = new GenAiService(factory);
  const adbSqlService = new AdbSqlService(factory, context.globalStorageUri.fsPath);

  // Controller manages state and service interactions
  const controller = new Controller(authManager, ociService, genAiService, adbSqlService, context.workspaceState);

  // Sidebar webview providers (React app)
  const mainWebviewProvider = new OciWebviewProvider(context, controller, "main");

  context.subscriptions.push(
    new vscode.Disposable(() => {
      void adbSqlService.dispose();
    }),
    vscode.window.registerWebviewViewProvider(
      OciWebviewProvider.MAIN_VIEW_ID,
      mainWebviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Register commands
  registerCommands(context, {
    authManager,
    ociService,
    genAiService,
    controller,
    refreshCompute: () => mainWebviewProvider.refresh(),
    refreshAdb: () => mainWebviewProvider.refresh(),
    refreshProfileDescription: () => mainWebviewProvider.refreshProfileDescription(),
  });

  // Ensure Generative AI Chat is open by default on every activation/reload
  vscode.commands.executeCommand("ociAi.mainView.focus");
}

export function deactivate(): void { }
