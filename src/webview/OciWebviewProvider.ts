import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Controller } from "../controller/index";
import { handleGrpcRequest, handleGrpcRequestCancel } from "../controller/grpc-handler";
import type { ExtensionMessage, WebviewMessage } from "../shared/messages";

type HostView = "chat" | "settings" | "compute" | "adb";

export class OciWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly CHAT_VIEW_ID = "ociAi.chatView";
  public static readonly SETTINGS_VIEW_ID = "ociAi.settingsView";
  public static readonly COMPUTE_VIEW_ID = "ociAi.computeView";
  public static readonly ADB_VIEW_ID = "ociAi.adbView";

  private webview?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly controller: Controller,
    private readonly hostView: HostView,
  ) {}

  /** Send a refresh signal to the webview */
  public refresh(): void {
    this.postMessageToWebview({ type: "grpc_response", grpc_response: { request_id: "__refresh__", message: { refresh: true } } });
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.webview = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(this.context.extensionPath)],
    };

    webviewView.webview.html =
      this.context.extensionMode === vscode.ExtensionMode.Development
        ? await this.getHMRHtmlContent(webviewView.webview, this.hostView)
        : this.getHtmlContent(webviewView.webview, this.hostView);

    this.setWebviewMessageListener(webviewView.webview);

    webviewView.onDidChangeVisibility(
      () => {
        if (this.webview?.visible) {
          this.controller.broadcastState();
        }
      },
      null,
      this.disposables,
    );

    webviewView.onDidDispose(
      () => {
        this.dispose();
      },
      null,
      this.disposables,
    );
  }

  private setWebviewMessageListener(webview: vscode.Webview): void {
    webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        this.handleWebviewMessage(message);
      },
      null,
      this.disposables,
    );
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    const postMessage = (response: ExtensionMessage) => this.postMessageToWebview(response);

    switch (message.type) {
      case "grpc_request": {
        if (message.grpc_request) {
          await handleGrpcRequest(this.controller, postMessage, message.grpc_request);
        }
        break;
      }
      case "grpc_request_cancel": {
        if (message.grpc_request_cancel) {
          await handleGrpcRequestCancel(
            this.controller,
            postMessage,
            message.grpc_request_cancel.request_id,
          );
        }
        break;
      }
    }
  }

  private postMessageToWebview(message: ExtensionMessage): Thenable<boolean | undefined> {
    if (!this.webview) {
      return Promise.resolve(undefined);
    }
    return this.webview.webview.postMessage(message);
  }

  /** Production: serve built React app */
  private getHtmlContent(webview: vscode.Webview, hostView: HostView): string {
    const buildDir = path.join(this.context.extensionPath, "webview-ui", "build", "assets");

    let jsFile = "index.js";
    let cssFile = "index.css";

    // Check if build files exist
    try {
      const files = fs.readdirSync(buildDir);
      const js = files.find(f => f.endsWith(".js"));
      const css = files.find(f => f.endsWith(".css"));
      if (js) jsFile = js;
      if (css) cssFile = css;
    } catch {
      // Build directory doesn't exist yet
    }

    const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildDir, jsFile)));
    const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildDir, cssFile)));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src data: blob:; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: blob:;" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>OCI AI</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.__OCI_AI_HOST_VIEW__=${JSON.stringify(hostView)};</script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  /** Development: use Vite HMR dev server */
  private async getHMRHtmlContent(webview: vscode.Webview, hostView: HostView): Promise<string> {
    const portFilePath = path.join(this.context.extensionPath, "webview-ui", ".vite-port");

    let port = "25464";
    try {
      port = fs.readFileSync(portFilePath, "utf-8").trim();
    } catch {
      // Use default port
    }

    const localServerUrl = `http://localhost:${port}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' ${localServerUrl}; script-src 'unsafe-inline' ${localServerUrl}; connect-src ws://localhost:* ${localServerUrl} data: blob:; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: blob:;" />
  <title>OCI AI</title>
</head>
<body>
  <div id="root"></div>
  <script>window.__OCI_AI_HOST_VIEW__=${JSON.stringify(hostView)};</script>
  <script type="module">
    import RefreshRuntime from "${localServerUrl}/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
  <script type="module" src="${localServerUrl}/src/main.tsx"></script>
</body>
</html>`;
  }

  private dispose(): void {
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
