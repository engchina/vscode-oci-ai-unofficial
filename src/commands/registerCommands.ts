import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { Controller } from "../controller/index";
import { AdbTreeItem } from "../providers/adbProvider";
import { ComputeTreeItem } from "../providers/computeProvider";
import { GenAiService } from "../oci/genAiService";
import { OciService } from "../oci/ociService";

export function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: {
    authManager: AuthManager;
    ociService: OciService;
    genAiService: GenAiService;
    controller: Controller;
    refreshCompute: () => void;
    refreshAdb: () => void;
  }
): void {
  const { authManager, ociService, controller, refreshCompute, refreshAdb } = dependencies;

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
    // Open settings: reveal sidebar and fire settings button event
    vscode.commands.registerCommand("ociAi.openSettings", async () => {
      await vscode.commands.executeCommand("ociAi.chatView.focus");
      await controller.fireSettingsButtonClicked();
    }),
    // Open chat: reveal sidebar and fire chat button event
    vscode.commands.registerCommand("ociAi.openChat", async () => {
      await vscode.commands.executeCommand("ociAi.chatView.focus");
      await controller.fireChatButtonClicked();
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
  );
}
