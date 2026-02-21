import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { AdbTreeItem } from "../providers/adbProvider";
import { ComputeTreeItem } from "../providers/computeProvider";
import { GenAiService } from "../oci/genAiService";
import { OciService } from "../oci/ociService";
import { ChatPanel } from "../webview/chatPanel";
import { SettingsPanel } from "../webview/settingsPanel";

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
  const { authManager, ociService, genAiService, refreshCompute, refreshAdb } = dependencies;

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
    vscode.commands.registerCommand("ociAi.openSettings", () => {
      SettingsPanel.createOrShow(context, authManager, () => {
        refreshCompute();
        refreshAdb();
      });
    }),
    vscode.commands.registerCommand("ociAi.compute.start", async (item?: ComputeTreeItem) => {
      if (!item?.resource.id) {
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Starting ${item.resource.name}...` },
        async () => {
          await ociService.startComputeInstance(item.resource.id);
          vscode.window.showInformationMessage(`Start requested for ${item.resource.name}`);
        }
      );
      refreshCompute();
    }),
    vscode.commands.registerCommand("ociAi.compute.stop", async (item?: ComputeTreeItem) => {
      if (!item?.resource.id) {
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Stopping ${item.resource.name}...` },
        async () => {
          await ociService.stopComputeInstance(item.resource.id);
          vscode.window.showInformationMessage(`Stop requested for ${item.resource.name}`);
        }
      );
      refreshCompute();
    }),
    vscode.commands.registerCommand("ociAi.adb.start", async (item?: AdbTreeItem) => {
      if (!item?.resource.id) {
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Starting ${item.resource.name}...` },
        async () => {
          await ociService.startAutonomousDatabase(item.resource.id);
          vscode.window.showInformationMessage(`Start requested for ${item.resource.name}`);
        }
      );
      refreshAdb();
    }),
    vscode.commands.registerCommand("ociAi.adb.stop", async (item?: AdbTreeItem) => {
      if (!item?.resource.id) {
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Stopping ${item.resource.name}...` },
        async () => {
          await ociService.stopAutonomousDatabase(item.resource.id);
          vscode.window.showInformationMessage(`Stop requested for ${item.resource.name}`);
        }
      );
      refreshAdb();
    }),
    vscode.commands.registerCommand("ociAi.openChat", () => {
      ChatPanel.createOrShow(context, (messages, onToken) =>
        genAiService.chatStream(messages, onToken)
      );
    })
  );
}
