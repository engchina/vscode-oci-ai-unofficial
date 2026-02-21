import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { registerCommands } from "./commands/registerCommands";
import { Controller } from "./controller/index";
import { OciClientFactory } from "./oci/clientFactory";
import { GenAiService } from "./oci/genAiService";
import { OciService } from "./oci/ociService";
import { AdbProvider } from "./providers/adbProvider";
import { ComputeProvider } from "./providers/computeProvider";
import { OciWebviewProvider } from "./webview/OciWebviewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const authManager = new AuthManager(context);
  const factory = new OciClientFactory(authManager);
  const ociService = new OciService(factory);
  const genAiService = new GenAiService(factory);

  // Controller manages state and service interactions
  const controller = new Controller(authManager, ociService, genAiService);

  // Sidebar webview provider (React app)
  const webviewProvider = new OciWebviewProvider(context, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OciWebviewProvider.VIEW_ID,
      webviewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Tree data providers
  const computeProvider = new ComputeProvider(ociService);
  const adbProvider = new AdbProvider(ociService);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ociAi.computeView", computeProvider),
    vscode.window.registerTreeDataProvider("ociAi.adbView", adbProvider),
  );

  // Register commands
  registerCommands(context, {
    authManager,
    ociService,
    genAiService,
    controller,
    refreshCompute: () => computeProvider.refresh(),
    refreshAdb: () => adbProvider.refresh(),
  });
}

export function deactivate(): void {}
