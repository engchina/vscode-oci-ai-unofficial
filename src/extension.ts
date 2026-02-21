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
  const chatWebviewProvider = new OciWebviewProvider(context, controller, "chat");
  const settingsWebviewProvider = new OciWebviewProvider(context, controller, "settings");
  const computeWebviewProvider = new OciWebviewProvider(context, controller, "compute");
  const adbWebviewProvider = new OciWebviewProvider(context, controller, "adb");

  context.subscriptions.push(
    new vscode.Disposable(() => {
      void adbSqlService.dispose();
    }),
    vscode.window.registerWebviewViewProvider(
      OciWebviewProvider.CHAT_VIEW_ID,
      chatWebviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      OciWebviewProvider.SETTINGS_VIEW_ID,
      settingsWebviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      OciWebviewProvider.COMPUTE_VIEW_ID,
      computeWebviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.window.registerWebviewViewProvider(
      OciWebviewProvider.ADB_VIEW_ID,
      adbWebviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Register commands
  registerCommands(context, {
    authManager,
    ociService,
    genAiService,
    controller,
    refreshCompute: () => computeWebviewProvider.refresh(),
    refreshAdb: () => adbWebviewProvider.refresh(),
  });

  // Ensure Generative AI Chat is open by default on every activation/reload
  vscode.commands.executeCommand("ociAi.chatView.focus");
}

export function deactivate(): void {}
