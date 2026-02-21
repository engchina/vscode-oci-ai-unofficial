import * as vscode from "vscode";
import { ApiKeySecrets, AuthManager } from "../auth/authManager";

type SettingsState = {
  profile: string;
  region: string;
  compartmentId: string;
  genAiLlmModelId: string;
  genAiEmbeddingModelId: string;
} & ApiKeySecrets;

export class SettingsPanel {
  private static currentPanel: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  public static createOrShow(
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    onSaved: () => void
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel("ociAiSettings", "OCI Settings", column, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    SettingsPanel.currentPanel = new SettingsPanel(panel, context, authManager, onSaved);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    authManager: AuthManager,
    onSaved: () => void
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(
      () => {
        SettingsPanel.currentPanel = undefined;
      },
      null,
      context.subscriptions
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message?.type === "ready") {
          const cfg = vscode.workspace.getConfiguration("ociAi");
          const secrets = await authManager.getApiKeySecrets();
          const state: SettingsState = {
            profile: cfg.get<string>("profile", "DEFAULT"),
            region: cfg.get<string>("region", ""),
            compartmentId: cfg.get<string>("compartmentId", ""),
            genAiLlmModelId: cfg.get<string>("genAiLlmModelId", "") || cfg.get<string>("genAiModelId", ""),
            genAiEmbeddingModelId: cfg.get<string>("genAiEmbeddingModelId", ""),
            ...secrets
          };
          await this.panel.webview.postMessage({ type: "state", payload: state });
          return;
        }

        if (message?.type !== "save") {
          return;
        }

        const payload = (message?.payload ?? {}) as Partial<SettingsState>;
        await vscode.workspace
          .getConfiguration("ociAi")
          .update("profile", String(payload.profile ?? "").trim() || "DEFAULT", vscode.ConfigurationTarget.Global);
        await authManager.updateRegion(String(payload.region ?? ""));
        await authManager.updateCompartmentId(String(payload.compartmentId ?? ""));
        await vscode.workspace
          .getConfiguration("ociAi")
          .update("genAiLlmModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
        await vscode.workspace
          .getConfiguration("ociAi")
          .update(
            "genAiEmbeddingModelId",
            String(payload.genAiEmbeddingModelId ?? "").trim(),
            vscode.ConfigurationTarget.Global
          );
        await vscode.workspace
          .getConfiguration("ociAi")
          .update("genAiModelId", String(payload.genAiLlmModelId ?? "").trim(), vscode.ConfigurationTarget.Global);
        await authManager.updateApiKeySecrets({
          tenancyOcid: String(payload.tenancyOcid ?? ""),
          userOcid: String(payload.userOcid ?? ""),
          fingerprint: String(payload.fingerprint ?? ""),
          privateKey: String(payload.privateKey ?? ""),
          privateKeyPassphrase: String(payload.privateKeyPassphrase ?? "")
        });
        onSaved();
        vscode.window.showInformationMessage("OCI settings saved.");
      },
      null,
      context.subscriptions
    );
  }

  private getHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OCI Settings</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
      display: grid;
      gap: 16px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    h2 {
      margin: 0 0 2px 0;
      font-size: 14px;
    }
    label {
      font-size: 12px;
      display: grid;
      gap: 6px;
    }
    input, textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      padding: 8px;
      font-size: 12px;
      font-family: var(--vscode-font-family);
    }
    textarea { min-height: 110px; }
    button {
      justify-self: start;
      border: none;
      border-radius: 6px;
      padding: 8px 12px;
      cursor: pointer;
      color: #fff;
      background: #0e7490;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>Connection</h2>
    <label>Profile Name
      <input id="profile" placeholder="DEFAULT" />
    </label>
    <label>Region
      <input id="region" placeholder="us-phoenix-1" />
    </label>
    <label>Compartment ID
      <input id="compartmentId" placeholder="ocid1.compartment..." />
    </label>
  </div>

  <div class="card">
    <h2>OCI Generative AI</h2>
    <label>LLM Model Name
      <input id="genAiLlmModelId" placeholder="meta.llama-3.1-70b-instruct" />
    </label>
    <label>Embedding Model Name
      <input id="genAiEmbeddingModelId" placeholder="cohere.embed-english-v3.0" />
    </label>
  </div>

  <div class="card">
    <h2>OCI API Key</h2>
    <label>Tenancy OCID
      <input id="tenancyOcid" placeholder="ocid1.tenancy..." />
    </label>
    <label>User OCID
      <input id="userOcid" placeholder="ocid1.user..." />
    </label>
    <label>Fingerprint
      <input id="fingerprint" placeholder="aa:bb:cc:..." />
    </label>
    <label>Private Key
      <textarea id="privateKey" placeholder="-----BEGIN PRIVATE KEY-----"></textarea>
    </label>
    <input id="privateKeyFile" type="file" accept=".pem,.key,.txt" />
    <label>Private Key Passphrase
      <input id="privateKeyPassphrase" type="password" />
    </label>
  </div>

  <button id="saveBtn" type="button">Save Settings</button>

  <script>
    const vscode = acquireVsCodeApi();
    const ids = [
      'profile',
      'region',
      'compartmentId',
      'genAiLlmModelId',
      'genAiEmbeddingModelId',
      'tenancyOcid',
      'userOcid',
      'fingerprint',
      'privateKey',
      'privateKeyPassphrase'
    ];

    const setValues = (payload) => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.value = payload?.[id] || '';
      }
    };

    document.getElementById('saveBtn').addEventListener('click', () => {
      const payload = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        payload[id] = el ? el.value : '';
      }
      vscode.postMessage({ type: 'save', payload });
    });

    document.getElementById('privateKeyFile').addEventListener('change', async (event) => {
      const input = event.target;
      const file = input?.files?.[0];
      if (!file) return;
      const content = await file.text();
      const privateKeyEl = document.getElementById('privateKey');
      if (privateKeyEl) {
        privateKeyEl.value = content;
      }
    });

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        setValues(event.data.payload);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
