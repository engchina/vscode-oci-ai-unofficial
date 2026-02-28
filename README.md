# vscode-oci-ai-unofficial (VS Code Extension)

A VS Code extension for OCI operations and AI-assisted development workflows.

## Features

- **Generative AI Chat** — Stream chat against any OCI Generative AI model (Llama, Gemini, xAI, etc.)
- **AI Code Review** — Right-click any selection → auto-submit a code review request to the chat
- **AI Doc Generation** — Right-click any selection → auto-submit a documentation generation request
- **Send to Chat** — Right-click any selection (or file) to paste it as context into the chat textarea
- **System Prompt** — Configure a persistent system instruction prepended to every chat session
- **Compute Instances** — List, start, stop OCI compute instances with live status polling
- **Autonomous Databases** — List, start, stop ADB instances with live status polling
- **Auto-refresh** — Resources in transitional states (STARTING, STOPPING, etc.) refresh every 5 s automatically
- **Search / Filter** — Filter compute or ADB lists by name or OCID in real time
- **Multi-Compartment Switching** — Save named compartments and switch between them via QuickPick or Settings UI
- **API Key Auth Only** — Store OCI credentials in VS Code SecretStorage; OCI config files are not used
- **Configuration Validation** — Missing compartment ID or model name shows a warning banner in the chat view
- **Chat History Persistence** — Conversation history survives VS Code restarts (last 100 messages per workspace)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Build once:

```bash
npm run build
```

3. In VS Code, press `F5` to run Extension Development Host.

## Required Settings

Open the **OCI Settings** panel or use `vscode-oci-ai-unofficial: Configure Profile` to set up.

| Setting | Required | Description |
|---------|----------|-------------|
| `ociAi.activeProfile` | Required | Active profile name used to scope SecretStorage credentials (default: `DEFAULT`) |
| `ociAi.authMode` | Fixed | `api-key` |
| `ociAi.compartmentId` | Yes | Compartment OCID for Compute and ADB list/actions |
| `ociAi.genAiLlmModelId` | Yes | LLM model name for AI chat (e.g. `meta.llama-3.1-70b-instruct`) |
| `ociAi.region` | Optional | OCI region override (e.g. `us-phoenix-1`) |
| `ociAi.genAiRegion` | Optional | Dedicated region for OCI Generative AI; falls back to `ociAi.region` |
| `ociAi.genAiEmbeddingModelId` | Optional | Embedding model name |
| `ociAi.configFilePath` | Deprecated | Ignored |
| `ociAi.systemPrompt` | Optional | System instructions prepended to every chat session |
| `ociAi.savedCompartments` | Optional | Named compartment list for quick switching (managed via Settings UI) |

## Authentication

**API Key Auth** (SecretStorage only)
- Run `vscode-oci-ai-unofficial: Store API Key in Secret Storage` or fill in the API Key card in OCI Settings.
- All four fields are required: Tenancy OCID, User OCID, Fingerprint, and Private Key.

This extension uses API Key auth only. It does not fall back to `~/.oci/config`.

## Commands

| Command | Description |
|---------|-------------|
| `vscode-oci-ai-unofficial: Open Chat` | Focus the Generative AI Chat panel |
| `vscode-oci-ai-unofficial: Open OCI Settings` | Focus the OCI Settings panel |
| `vscode-oci-ai-unofficial: Configure Profile` | Interactive wizard to set profile/region/compartment |
| `vscode-oci-ai-unofficial: Store API Key in Secret Storage` | Store API key credentials securely |
| `vscode-oci-ai-unofficial: Switch Compartment` | QuickPick to switch active compartment from saved list |
| `OCI AI: Send to Chat` | Send selected code (or whole file) to chat as context |
| `OCI AI: Code Review` | Auto-send selected code for AI code review |
| `OCI AI: Generate Documentation` | Auto-send selected code for AI doc generation |

The last three commands also appear in the **editor right-click context menu**.

## Notes

- OCI Generative AI does not support a native `system` role. The system prompt is injected as a USER→ASSISTANT exchange pair prepended to each request.
- Chat history is persisted per workspace via VS Code `workspaceState` (last 100 messages).
- The extension tries multiple request format variants automatically to handle API differences across model families.
