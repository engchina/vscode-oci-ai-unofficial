import * as vscode from "vscode";
import { AuthManager } from "./auth/authManager";
import { registerCommands } from "./commands/registerCommands";
import { OciClientFactory } from "./oci/clientFactory";
import { GenAiService } from "./oci/genAiService";
import { OciService } from "./oci/ociService";
import { AdbProvider } from "./providers/adbProvider";
import { ComputeProvider } from "./providers/computeProvider";

export function activate(context: vscode.ExtensionContext): void {
  const authManager = new AuthManager(context);
  const factory = new OciClientFactory(authManager);
  const ociService = new OciService(factory);
  const genAiService = new GenAiService(factory);

  const computeProvider = new ComputeProvider(ociService);
  const adbProvider = new AdbProvider(ociService);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ociAi.computeView", computeProvider),
    vscode.window.registerTreeDataProvider("ociAi.adbView", adbProvider)
  );

  registerCommands(context, {
    authManager,
    ociService,
    genAiService,
    refreshCompute: () => computeProvider.refresh(),
    refreshAdb: () => adbProvider.refresh()
  });
}

export function deactivate(): void {}
