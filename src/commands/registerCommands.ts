import * as path from "path";
import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";
import { Controller } from "../controller/index";
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
    refreshProfileDescription: () => void;
  }
): void {
  const { authManager, controller, refreshCompute, refreshAdb } = dependencies;

  context.subscriptions.push(
    vscode.commands.registerCommand("ociAi.refreshCompute", refreshCompute),
    vscode.commands.registerCommand("ociAi.refreshAdb", refreshAdb),
    vscode.commands.registerCommand("ociAi.auth.configureProfile", async () => {
      await authManager.configureProfileInteractive();
      dependencies.refreshProfileDescription();
      await controller.broadcastState();
      refreshCompute();
      refreshAdb();
    }),
    vscode.commands.registerCommand("ociAi.auth.configureApiKey", async () => {
      await authManager.configureApiKeyInteractive();
    }),
    // Open settings: reveal OCI Settings view
    vscode.commands.registerCommand("ociAi.openSettings", async () => {
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    // Open chat: reveal Generative AI Chat view
    vscode.commands.registerCommand("ociAi.openChat", async () => {
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    // Send selected code (or current file) to AI chat
    vscode.commands.registerCommand("ociAi.editor.sendToChat", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found.");
        return;
      }

      const selection = editor.selection;
      const code = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection);

      if (!code.trim()) {
        vscode.window.showWarningMessage("No code selected or file is empty.");
        return;
      }

      const filename = path.basename(editor.document.fileName);
      const language = editor.document.languageId;

      await controller.fireCodeContext({ code, filename, language });
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    // AI Code Review: send selected code with a review prompt
    vscode.commands.registerCommand("ociAi.editor.codeReview", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found.");
        return;
      }
      const selection = editor.selection;
      const code = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection);
      if (!code.trim()) {
        vscode.window.showWarningMessage("No code selected or file is empty.");
        return;
      }
      const filename = path.basename(editor.document.fileName);
      const language = editor.document.languageId;
      const prompt = "Please review this code. Identify any bugs, security issues, performance problems, and suggest improvements.";
      await controller.fireCodeContext({ code, filename, language, prompt });
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    // Generate Docs: send selected code with a doc generation prompt
    vscode.commands.registerCommand("ociAi.editor.generateDocs", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found.");
        return;
      }
      const selection = editor.selection;
      const code = selection.isEmpty
        ? editor.document.getText()
        : editor.document.getText(selection);
      if (!code.trim()) {
        vscode.window.showWarningMessage("No code selected or file is empty.");
        return;
      }
      const filename = path.basename(editor.document.fileName);
      const language = editor.document.languageId;
      const prompt = "Please generate comprehensive documentation (JSDoc/docstring) for this code, including parameter descriptions, return values, and usage examples.";
      await controller.fireCodeContext({ code, filename, language, prompt });
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    // Switch compartment via QuickPick
    vscode.commands.registerCommand("ociAi.switchCompartment", async () => {
      const cfg = vscode.workspace.getConfiguration("ociAi");
      const savedRaw = cfg.get<{ name: string; id: string }[]>("savedCompartments", []);
      const saved = Array.isArray(savedRaw) ? savedRaw : [];
      const current = cfg.get<string>("compartmentId", "").trim();

      type QpItem = vscode.QuickPickItem & { id?: string };
      const items: QpItem[] = [
        ...saved.map(c => ({
          label: c.name,
          description: c.id,
          detail: c.id === current ? "$(check) Active" : undefined,
          id: c.id,
        })),
        { label: "$(plus) Enter compartment ID manually...", id: undefined },
      ];

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a compartment to switch to",
        title: "Switch Compartment",
      });
      if (!picked) return;

      let targetId = picked.id;
      if (!targetId) {
        const input = await vscode.window.showInputBox({
          title: "Compartment OCID",
          prompt: "Enter the compartment OCID to switch to",
          ignoreFocusOut: true,
        });
        if (!input?.trim()) return;
        targetId = input.trim();
      }

      await controller.switchCompartment(targetId);
      vscode.window.showInformationMessage(`Switched to compartment: ${targetId}`);
      refreshCompute();
      refreshAdb();
    }),
    // Start/Stop commands are handled directly in the webview; these are no-ops for compatibility
    vscode.commands.registerCommand("ociAi.compute.start", () => { }),
    vscode.commands.registerCommand("ociAi.compute.stop", () => { }),
    vscode.commands.registerCommand("ociAi.adb.start", () => { }),
    vscode.commands.registerCommand("ociAi.adb.stop", () => { }),
  );
}
