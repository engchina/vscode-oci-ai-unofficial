import * as vscode from "vscode";

type PromptHandler = (prompt: string) => Promise<string>;

export class ChatPanel {
  private static currentPanel: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  public static createOrShow(context: vscode.ExtensionContext, handlePrompt: PromptHandler): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel("ociAiChat", "vscode-oci-ai-unofficial Chat", column, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    ChatPanel.currentPanel = new ChatPanel(panel, context, handlePrompt);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    handlePrompt: PromptHandler
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(
      () => {
        ChatPanel.currentPanel = undefined;
      },
      null,
      context.subscriptions
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message?.type !== "prompt") {
          return;
        }

        const text = typeof message.text === "string" ? message.text : "";
        if (!text.trim()) {
          return;
        }

        try {
          const answer = await handlePrompt(text.trim());
          this.panel.webview.postMessage({ type: "assistant", text: answer });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.panel.webview.postMessage({ type: "assistant", text: `Request failed: ${detail}` });
        }
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
  <title>vscode-oci-ai-unofficial Chat</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif;
      margin: 0;
      display: grid;
      grid-template-rows: 1fr auto;
      height: 100vh;
      background: radial-gradient(circle at top, rgba(56, 189, 248, 0.15), transparent 45%), var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    #messages {
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .msg {
      max-width: 85%;
      padding: 10px 12px;
      border-radius: 10px;
      white-space: pre-wrap;
      line-height: 1.4;
      border: 1px solid transparent;
    }
    .user {
      align-self: flex-end;
      background: rgba(249, 115, 22, 0.2);
      border-color: rgba(249, 115, 22, 0.45);
    }
    .assistant {
      align-self: flex-start;
      background: rgba(56, 189, 248, 0.15);
      border-color: rgba(56, 189, 248, 0.35);
    }
    form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, black 10%);
    }
    input {
      flex: 1;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }
    button {
      border: none;
      border-radius: 8px;
      padding: 8px 12px;
      background: #0ea5e9;
      color: white;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div id="messages"></div>
  <form id="form">
    <input id="prompt" placeholder="Ask vscode-oci-ai-unofficial..." />
    <button type="submit">Send</button>
  </form>
  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const form = document.getElementById('form');
    const promptEl = document.getElementById('prompt');

    const addMessage = (text, cls) => {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    };

    addMessage('Chat is ready. Configure ociAi.genAiModelId for OCI-backed responses.', 'assistant');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      addMessage(text, 'user');
      promptEl.value = '';
      vscode.postMessage({ type: 'prompt', text });
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'assistant') {
        addMessage(message.text, 'assistant');
      }
    });
  </script>
</body>
</html>`;
  }
}
