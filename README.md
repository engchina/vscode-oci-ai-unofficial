# vscode-oci-ai-unofficial

OCI の日常運用と AI 支援開発を、VS Code サイドバー内で完結させるための拡張機能です。  
本プロジェクトは「チャット専用ツール」ではなく、**設定管理 / Chat / VCN / Compute / Object Storage / Autonomous DB / Oracle Base DB / SQL Workbench** を統合した、実運用志向のオールインワン UI を提供します。

---

## 1. この拡張でできること

### Generative AI Chat
- OCI Generative AI へのストリーミング応答
- モデル切り替え（`genAiLlmModelId` に複数モデルをカンマ区切りで指定）
- 画像付きメッセージ送信（data URL 形式、上限あり）
- System Prompt の常時付与
- 会話履歴の保持・再編集・再生成

### エディタ連携（右クリック）
- `OCI AI: Send to Chat`
- `OCI AI: Code Review`
- `OCI AI: Generate Documentation`

### OCI リソース運用
- **Compute**: 一覧、起動/停止、SSH 接続
- **Autonomous AI Database**: 一覧、起動/停止、Wallet ダウンロード、接続、SQL 実行
- **Oracle Base Database Service**: 一覧、起動/停止、接続文字列取得、SSH、SQL 実行
- **VCN**: 一覧、Security List 管理（参照/作成/更新/削除）
- **Object Storage**: バケット/オブジェクト参照、Upload/Download、PAR 発行

### SQL Workbench
- ADB / DB System への接続・SQL 実行
- Explain Plan
- SQL 履歴（保存上限あり）
- SQL Favorites
- AI SQL Assistant（SQL 生成 / 最適化）

---

## 2. アーキテクチャ概要

- 拡張本体: TypeScript（`src/*`）
- UI: React + Vite（`webview-ui/*`）
- 通信: Webview ↔ Extension 間を gRPC 風メッセージで抽象化
- 認証: VS Code `SecretStorage`（API Key のみ）

`Controller` が状態管理の中心で、Chat 履歴・SQL 履歴/お気に入り・設定保存を一元的に扱います。

---

## 3. 認証とセキュリティ

本拡張は **API Key 認証のみ** サポートします。

- 認証情報は `SecretStorage` に保存
- `~/.oci/config` にはフォールバックしない
- 必須項目:
  - Tenancy OCID
  - User OCID
  - Fingerprint
  - Private Key

設定不足時は Chat 画面に警告が表示されます（Compartment / Model / API Key 欠落など）。

---

## 4. クイックスタート（開発）

```bash
npm install
npm run build
```

VS Code で `F5` を押し、Extension Development Host を起動してください。

---

## 5. 主要コマンド

| Command | 説明 |
|---|---|
| `vscode-oci-ai-unofficial: Open Chat` | メインビューを表示（Chat を利用） |
| `vscode-oci-ai-unofficial: Open OCI Settings` | メインビューを表示（Settings を利用） |
| `vscode-oci-ai-unofficial: Switch Profile` | アクティブプロファイルを切替 |
| `vscode-oci-ai-unofficial: Store API Key in Secret Storage` | API Key を SecretStorage に保存 |
| `vscode-oci-ai-unofficial: Switch Compartment` | 保存済みコンパートメントを切替 |
| `OCI AI: Send to Chat` | 選択コード/ファイル内容を Chat へ送信 |
| `OCI AI: Code Review` | 選択コードをレビュー依頼として送信 |
| `OCI AI: Generate Documentation` | 選択コードをドキュメント生成依頼として送信 |

> `Send to Chat / Code Review / Generate Documentation` はエディタ右クリックメニューにも表示されます。

---

## 6. 主要設定（`ociAi.*`）

### 必須級（実運用でほぼ必須）

| 設定 | 説明 |
|---|---|
| `ociAi.activeProfile` | 現在のプロファイル名（既定 `DEFAULT`） |
| `ociAi.authMode` | `api-key` 固定 |
| `ociAi.genAiLlmModelId` | Chat で利用する LLM モデル名（複数可） |
| `ociAi.compartmentId` | 互換用途のデフォルト Compartment |

### AI/Chat チューニング

| 設定 | 説明 |
|---|---|
| `ociAi.genAiRegion` | Generative AI 専用リージョン |
| `ociAi.genAiEmbeddingModelId` | Embedding モデル |
| `ociAi.systemPrompt` | セッション先頭に注入する指示 |
| `ociAi.chatMaxTokens` | 最大トークン |
| `ociAi.chatTemperature` | Temperature |
| `ociAi.chatTopP` | Top-p |

### Oracle DB 実行系

| 設定 | 説明 |
|---|---|
| `ociAi.oracleDbDriverMode` | `auto` / `thin` / `thick` |
| `ociAi.oracleClientLibDir` | Thick モード用 Instant Client パス |

### 機能別 Compartment 選択

| 設定 | 説明 |
|---|---|
| `ociAi.computeCompartmentIds` | Compute 対象 |
| `ociAi.chatCompartmentId` | Chat 対象 |
| `ociAi.adbCompartmentIds` | ADB 対象 |
| `ociAi.dbSystemCompartmentIds` | DB System 対象 |
| `ociAi.vcnCompartmentIds` | VCN 対象 |
| `ociAi.objectStorageCompartmentIds` | Object Storage 対象 |

### プロファイル関連

| 設定 | 説明 |
|---|---|
| `ociAi.profilesConfig` | プロファイルとコンパートメント一覧 |
| `ociAi.profileRegionMap` | プロファイルごとのリージョン紐付け |
| `ociAi.savedCompartments` | 互換用途の保存済みコンパートメント |

### 非推奨

- `ociAi.configFilePath`（無視されます）
- `ociAi.genAiModelId`（レガシー。`genAiLlmModelId` 推奨）

---

## 7. 画面別の実装ポイント（コード準拠）

- **Settings**
  - Profile 編集対象と実行時アクティブ Profile を分離
  - API Key 欠落チェック
  - Terminal 設定（シェル統合待機時間、SSH デフォルト）

- **Chat**
  - 設定不足警告バナー
  - コード文脈の自動注入（右クリック連携）
  - ストリーミング中断、編集再送、再生成

- **Compute / ADB / DB System**
  - 遷移状態（STARTING/STOPPING等）で 5 秒ポーリング
  - Guardrail ダイアログ付きの危険操作
  - SSH 接続（タスク起動）と per-resource オーバーライド

- **Object Storage**
  - Prefix ナビゲーション、検索
  - Upload/Download の直近アクション可視化
  - 24時間 PAR 生成とクリップボード連携

- **SQL Workbench**
  - ADB/DB System 両対応
  - Favorites/History 永続化
  - Explain Plan、AI SQL Assistant

---

## 8. 永続化ポリシー

- Chat 履歴: `workspaceState`（最新 100 メッセージ）
- SQL 履歴/お気に入り: `workspaceState`（上限あり）
- API Key 等の機密値: `SecretStorage`
- 一部 UI 補助値（SSH オーバーライド等）: Webview ローカルストレージ

---

## 9. ビルド / 開発用スクリプト

| Script | 説明 |
|---|---|
| `npm run build` | webview + extension をビルド |
| `npm run build:webview` | webview 側のみビルド |
| `npm run build:extension` | extension 側のみビルド |
| `npm run watch` | extension 側の watch ビルド |
| `npm run check` | TypeScript 型チェック |
| `npm run package` | VSIX パッケージ作成 |

---

## 10. 注意事項

- OCI Generative AI はネイティブ `system` ロール非対応のため、System Prompt は USER/ASSISTANT 形式で前置注入しています。
- モデル名は `ociAi.genAiLlmModelId` を優先し、必要時に `ociAi.genAiModelId` を後方互換で参照します。
- DB 接続や SSH はネットワーク要件・IAM ポリシー・セキュリティリスト設定の影響を受けます。
