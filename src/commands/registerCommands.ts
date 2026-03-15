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
    // Open settings: reveal Settings view
    vscode.commands.registerCommand("ociAi.openSettings", async () => {
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    // Open chat: reveal Generative AI Chat view
    vscode.commands.registerCommand("ociAi.openChat", async () => {
      await vscode.commands.executeCommand("ociAi.mainView.focus");
    }),
    vscode.commands.registerCommand("ociAi.bootstrap.initializeWorkspaceFiles", async () => {
      const directory = await controller.ensureBootstrapFiles();
      if (!directory) {
        vscode.window.showWarningMessage("No workspace folder is open.");
        return;
      }
      vscode.window.showInformationMessage(`Workspace bootstrap files are ready in ${directory}.`);
    }),
    vscode.commands.registerCommand("ociAi.skills.importFromSource", async () => {
      const sourceMode = await vscode.window.showQuickPick(
        [
          {
            label: "Browse Local Source",
            description: "Choose a local skill folder or archive from the filesystem",
            mode: "browse" as const,
          },
          {
            label: "Enter Source Manually",
            description: "Paste a local path, archive URL, or git repository URL",
            mode: "manual" as const,
          },
        ],
        {
          title: "Import External Skill",
          placeHolder: "Choose how to provide the skill source",
          ignoreFocusOut: true,
        },
      );
      if (!sourceMode) {
        return;
      }

      let source = "";
      if (sourceMode.mode === "browse") {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: "Use As Skill Source",
          title: "Choose a local skill folder or archive",
        });
        source = picked?.[0]?.fsPath ?? "";
      } else {
        source =
          (await vscode.window.showInputBox({
            title: "Import External Skill",
            prompt: "Enter a local folder, local archive, archive URL, or git repository URL",
            placeHolder: "/path/to/skill | https://.../skill.zip | https://github.com/org/repo::skills/my-skill",
            ignoreFocusOut: true,
          })) ?? "";
      }

      if (!source.trim()) {
        return;
      }

      const scopePick = await vscode.window.showQuickPick(
        [
          {
            label: "Workspace",
            description: "Install into <workspace>/skills",
            scope: "workspace" as const,
          },
          {
            label: "User",
            description: "Install into ~/.openclaw/skills",
            scope: "user" as const,
          },
        ],
        {
          title: "Import External Skill",
          placeHolder: "Choose the install scope",
          ignoreFocusOut: true,
        },
      );
      if (!scopePick) {
        return;
      }

      const replacePick = await vscode.window.showQuickPick(
        [
          {
            label: "No",
            description: "Fail if a skill folder with the same name already exists",
            replace: false,
          },
          {
            label: "Yes",
            description: "Replace an existing skill folder with the same name",
            replace: true,
          },
        ],
        {
          title: "Replace Existing Skill?",
          placeHolder: "Choose how to handle an existing skill directory",
          ignoreFocusOut: true,
        },
      );
      if (!replacePick) {
        return;
      }

      let result = await controller.importAgentSkillFromSource(
        source.trim(),
        scopePick.scope,
        replacePick.replace,
      );
      if (result.blockedBySecurity) {
        const confirm = await vscode.window.showWarningMessage(
          `${result.message}\n\n${result.warnings.slice(0, 3).join("\n")}`,
          { modal: true },
          "Import Anyway",
        );
        if (confirm !== "Import Anyway") {
          return;
        }
        result = await controller.importAgentSkillFromSource(
          source.trim(),
          scopePick.scope,
          replacePick.replace,
          true,
        );
      }
      if (result.ok) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showErrorMessage(result.message);
      }
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
