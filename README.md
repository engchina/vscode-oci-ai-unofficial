# vscode-oci-ai-unofficial (VS Code Extension)

A first working version of a VS Code extension for OCI operations:

- Compute list + start/stop
- Autonomous Database (ADB) list + start/stop
- vscode-oci-ai-unofficial Chat webview (basic panel + OCI call path)
- Auth setup commands for profile/settings + SecretStorage

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

Open settings and configure:

- `ociAi.profile` (default: `DEFAULT`)
- `ociAi.compartmentId` (required for list/actions)
- `ociAi.region` (optional)
- `ociAi.configFilePath` (optional, defaults to `~/.oci/config`)
- `ociAi.genAiRegion` (optional, dedicated region for OCI Generative AI; falls back to `ociAi.region`)
- `ociAi.genAiLlmModelId` (LLM model name, required if using OCI Generative AI chat)
- `ociAi.genAiEmbeddingModelId` (embedding model name, optional for embedding scenarios)

You can also run command:

- `vscode-oci-ai-unofficial: Configure Profile`

## Commands

- `vscode-oci-ai-unofficial: Configure Profile`
- `vscode-oci-ai-unofficial: Store API Key in Secret Storage`
- `Refresh Compute`
- `Compute: Start Instance`
- `Compute: Stop Instance`
- `Refresh ADB`
- `ADB: Start`
- `ADB: Stop`
- `vscode-oci-ai-unofficial: Open Chat`

## Notes

- The current auth runtime path uses OCI config file based auth.
- SecretStorage command is included for future explicit API key auth mode.
- Chat panel works now; OCI-backed responses depend on valid model/region/permissions.
