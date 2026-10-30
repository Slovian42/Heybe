<!-- Heybe：Mac で動くオープンソースの個人向け AI アシスタント / ローカル AI エージェント -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe：自分の Mac で動くオープンソースの個人向け AI アシスタント" width="760"></a>
</p>

<h1 align="center">Heybe：Mac で動くオープンソースの AI アシスタント</h1>

<p align="center"><b>ひと言伝えるだけ。あとは Heybe におまかせ。</b><br>
自分のパソコン上で動くローカル AI エージェント。サンドボックスの中で作業し、大事な操作の前には必ず確認します。<br>
標準は DeepSeek。OpenAI や Claude の API キーを持ち込むこともできます。</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: macOS (Apple Silicon)" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-black">
  <img alt="Status: developer preview in development" src="https://img.shields.io/badge/status-developer%20preview%20in%20development-orange">
  <a href="CONTRIBUTING.md"><img alt="DCO sign-off required" src="https://img.shields.io/badge/DCO-sign--off-green"></a>
  <a href="https://heybe.dev"><img alt="Website: heybe.dev" src="https://img.shields.io/badge/web-heybe.dev-E8453C"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <b>日本語</b> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (Brasil)</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **現在、開発者プレビュー版を開発中です。まだダウンロードはできません。** 下のスクリーンショットはサンプルデータを使ったデザインプレビューです。
> 公開時のお知らせは **[heybe.dev](https://heybe.dev)** から登録できます。[クリックできるプロトタイプ](https://heybe.dev/demo)も公開中です。

## Heybe とは？

Heybe は**自分のパソコンで動くプライベートな AI アシスタント**です。友だちに頼むように用件を伝えると、手順を立て、Web を調べ、レポートや下書きを作り、結果をファイルとして Mac に保存します。ウィンドウを閉じても作業は続きます。

AI エージェントを使ったことがない方にも、中身を確認・改造できる**セルフホスト型 AI アシスタント**がほしい個人事業主や開発者にも向けて作っています。

- **Mac 上で動作**：ファイル、タスク、履歴は手元の Mac に残ります。
- **安全な作業スペース**：操作は標準で隔離されたサンドボックス内で実行され、個人ファイルには触れません。
- **実行前に確認**：ファイルの削除、作業フォルダ外への書き込み、予算超過にはクリックでの承認が必要です。チャットで「はい」と打つだけでは実行されません。
- **AI は自由に選べる**：標準は DeepSeek。OpenAI や Anthropic Claude の API キーも使えます。Ollama でローカル LLM を動かせばオフラインでも会話できます。
- **オープンソース**：Community 版は Apache-2.0。ビルドや実行に私たちのアカウントは不要です。

## 画面イメージ（デザインプレビュー）

> v1 のデザインモックです。内容はサンプルで、実際の製品とは異なる場合があります。

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Heybe デスクトップアプリの画面一覧：初回設定、チャット、タスク進行、操作の承認、結果レポート、設定" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Heybe 初回設定：DeepSeek、自分の OpenAI・Claude API キー、Mac 上のローカルモデルから選択" width="420"><br>**1. 初回起動**：使う AI を選ぶ（DeepSeek、自分のキー、ローカル）。 | <img src="docs/images/heybe-chat-plan.png" alt="Heybe チャット：ローカル AI アシスタントがひと言からステップごとの計画を作成" width="420"><br>**2. チャット**：ひと言で計画を作成。ウィンドウを閉じても続行。 |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Heybe タスク進行：各ステップがサンドボックス内で実行され、停止ボタンと費用を表示" width="420"><br>**3. タスク進行中**：進捗、安全スペース表示、停止ボタン、ここまでの費用。 | <img src="docs/images/heybe-action-approval.png" alt="Heybe 承認ダイアログ：AI エージェントがファイル削除の前に確認し、拒否・編集・承認を選択" width="420"><br>**4. 承認**：大事な操作はクリック待ち（拒否・編集・承認）。 |
| <img src="docs/images/heybe-task-result-report.png" alt="Heybe 結果画面：出典付きの比較表とおすすめをローカルファイルとして保存" width="420"><br>**5. 結果**：出典付きのレポートを Heybe フォルダに保存。 | <img src="docs/images/heybe-settings-api-keys.png" alt="Heybe 設定：AI プロバイダと API キー、常時オンのサンドボックス、Telegram などのチャットアプリは近日対応" width="420"><br>**6. 設定**：AI とキー、安全ルール、チャットアプリ（近日対応）。 |

## Heybe でできること

| 頼み方 | Heybe がやること |
|---|---|
| 「このノートアプリ 5 つを比較して」 | 各サイトを確認し、出典付きの比較表とおすすめを作成。 |
| 「この議事録を週報にまとめて」 | 決定事項・ToDo・担当者を整理した下書きを作成。 |
| 「この記事とリンク先 3 本を要約して」 | ページを読み、リンク付きの短いまとめを作成。 |
| 「下書きフォルダを整理して」 | 古いコピーを見つけ、ゴミ箱に移す前に確認。 |
| 「週末のポートランド旅行の航空券とホテルを調べて」 | 候補を 1 ページにまとめて比較しやすく。 |
| 「今週のサイトの数字を振り返って」（個人事業主向け） | 簡単なまとめと来週のアイデア。 |

詳しくは [docs/use-cases.md](docs/use-cases.md)（英語）。最初のプレビュー後に、定時の朝のブリーフィング、値下がり通知、**Telegram** などのチャットアプリからの利用を予定しています。

## 機能と開発状況

| 機能 | 状況 |
|---|---|
| macOS デスクトップアプリ（Tauri + React）、Apple Silicon（M1 以降）のみ | 開発中 |
| DeepSeek（標準）、OpenAI、Claude（API キー持ち込み）でのストリーミング会話 | 開発中 |
| Ollama によるローカルモデル（チャットのみ、オフライン可） | 開発中 |
| Web ページを直接読む検索（出典付き） | 開発中 |
| ウィンドウを閉じても続く長時間タスク（ローカルのタスク管理、SQLite） | 骨組みをマージ済み |
| 標準でサンドボックス：セッションごとにマイクロ VM（BoxLite、代替は Lima） | 検証中 |
| 大事な操作のクリック承認（書き込み、削除、予算超過） | 開発中 |
| タスクごとの費用と使用モデルの表示 | 開発中 |
| heybe.dev から署名・公証済み DMG を配布、Apple Silicon 版のみ（Intel 版なし、Mac App Store なし） | 予定 |
| 見て・直して・消せる長期記憶 | v1.1 予定 |
| Telegram などのチャットアプリ | 予定 |
| エージェントチームの動的編成 | Heybe Pro（将来） |

## 類似サービスとの比較

2026 年 10 月時点の公開情報をもとにした要約です。各製品は頻繁に更新されるため、最新情報は各社の公式ドキュメントをご確認ください。

| | 動作場所 | ソース | モデル | 安全の仕組み | チャットアプリ |
|---|---|---|---|---|---|
| **Heybe**（開発中） | 自分の Mac | オープンソース（Apache-2.0）、将来 Pro 版 | DeepSeek、OpenAI、Claude（自分のキー）、Ollama | 標準サンドボックス + クリック承認 | Telegram 予定 |
| [ChatGPT](https://chatgpt.com)（Work / クラウドブラウザ） | OpenAI のクラウド、デスクトップ・モバイルアプリ | プロプライエタリ | OpenAI | 新しいサイトや重要な操作の前に確認 | — |
| [Claude](https://claude.com) デスクトップ（Cowork） | デスクトップアプリ（macOS、Windows）、コードはローカル VM で実行、クラウドセッションもあり | プロプライエタリ | Claude | 許可したフォルダのみ、重要操作は確認 | — |
| [Manus](https://manus.im) | クラウドエージェント、デスクトップアプリは許可したフォルダで作業 | プロプライエタリ | Manus が管理 | ローカルのコマンドごとに承認 | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | 自分の PC やサーバー（macOS、Windows、Linux） | オープンソース（MIT） | クラウド・ローカル | 任意のサンドボックス（Docker など） | 20 以上 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | セルフホストのマルチエージェント実行基盤 | ソース公開（FastClaw Community License） | クラウド・ローカル | 複数のサンドボックス | 複数 |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | ターミナル | オープンソース（Apache-2.0） | クラウド・ローカル | コード実行前に確認 | — |
| [Jan](https://jan.ai) | デスクトップアプリ | オープンソース（Apache-2.0） | ローカル（llama.cpp）とクラウド API | チャット中心、ツール呼び出しは承認制 | — |
| [LM Studio](https://lmstudio.ai) | デスクトップアプリ | プロプライエタリ（個人・業務で無料） | ローカルモデル | チャット中心 | — |

**Heybe を選ぶ理由**：自分の Mac で動き、オープンソースで、API キーを持ち込めて、AI とファイルの間にサンドボックスと承認ボタンがある **Manus の代替**・**ChatGPT エージェントの代替**を探している方に。
**まだ選ばない理由**：Heybe は未リリースです。今すぐ使いたい場合は、上の成熟したツールがおすすめです。

Heybe は FastClaw の `/v1` API の上で動作します。本リポジトリに FastClaw は含まれません（[NOTICE](NOTICE) 参照）。記載の製品名・商標は各所有者に帰属し、Heybe はいずれとも提携・推奨関係にありません。

## プライバシーと安全

v1 の設計ルールです。プレビュー公開前に、それぞれテストで確認します。

- **標準はローカル**：タスク・ファイル・履歴は Mac に保存。プロンプトは選んだ AI サービスにだけ送られ、ローカルモデルならどこにも送られません。
- **キーはあなたのもの**：API キーは macOS キーチェーンに保存し、リポジトリ・ログ・エクスポートには入れません。
- **サンドボックスは常時オン**：v1 にサンドボックスをオフにするモードはありません。
- **承認はクリックで**：何が起きるか、元に戻せるかを表示し、クリックするまで実行しません。
- **正直な結果**：失敗は失敗として表示。判断が必要な結果は「確認待ち」で止まります。

## ロードマップ

| 段階 | 内容 | 状況 |
|---|---|---|
| 0 | リポジトリ、FastClaw `/v1` アダプタ、サンドボックス検証、API 確認 | 進行中 |
| 1 | デスクトップチャット、プロバイダとキー、Web 読み取り、タスクと結果 | 進行中 |
| v1 開発者プレビュー | macOS（Apple Silicon）でソースからビルド | 未公開 |
| v1.1 | 長期記憶 | 予定 |
| その後 | Telegram などのチャットアプリ、定期タスク、マルチエージェント、署名済み DMG | 予定 |

進捗は [マイルストーン](https://github.com/Slovian42/Heybe/milestones) と [Issues](https://github.com/Slovian42/Heybe/issues) で公開しています。

## 開発者向けクイックスタート

現時点で動くのは TypeScript のワークスペース（アダプタ、タスク管理、仮のデスクトップ画面）とテストです。エンドツーエンドのアプリはまだありません。

```bash
# Node 20 以上と pnpm 10 が必要（corepack enable）
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + 境界チェック + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # 仮の画面：http://localhost:1420
```

FastClaw とサンドボックスの準備は [docs/phase0-dev-env.md](docs/phase0-dev-env.md)、[docs/sandbox-options.md](docs/sandbox-options.md) を参照してください。本物のキーをファイルに書かないでください（`.env` は git 管理外です）。

## よくある質問

<details><summary><b>Mac でローカルに動くオープンソースの AI アシスタントはありますか？</b></summary>
Heybe はまさにそれを目指して開発中です。Apache-2.0 で、Mac 上で動き、標準でサンドボックスが有効です。まだダウンロードはできません。</details>

<details><summary><b>Heybe は無料の Manus 代替ですか？</b></summary>
Community 版は無料のオープンソースです。作業は自分のパソコン上で行われます。費用は選んだ AI サービス（例：DeepSeek）の分だけで、ローカルモデルなら無料です。</details>

<details><summary><b>自分の OpenAI や Claude の API キーを使えますか？</b></summary>
はい。標準は DeepSeek ですが、OpenAI や Anthropic Claude のキーを持ち込めます。キーは macOS キーチェーンに保存されます。</details>

<details><summary><b>ローカル LLM でオフライン利用できますか？</b></summary>
v1 では Ollama を使ったオフラインのチャットを予定しています。ローカルモデルでのツール実行は、精度の面からまだ約束していません。</details>

<details><summary><b>AI エージェントにパソコンを操作させて安全ですか？</b></summary>
操作は標準で隔離されたサンドボックスで行われ、大事な操作はクリックで承認するまで実行されません。タスクはいつでも止められます。</details>

<details><summary><b>Telegram から使えますか？ Windows は？</b></summary>
Telegram などのチャットアプリは最初のプレビュー後に対応予定です。v1 は Apple Silicon（M1 以降）の Mac のみ対応で、Intel Mac には対応しません。</details>

## Community 版と Pro 版

| | Heybe Community | Heybe Pro（将来） |
|---|---|---|
| ライセンス | Apache-2.0（このリポジトリ） | プロプライエタリ（Slovian Inc） |
| アシスタント、タスク、サンドボックス、承認、キー持ち込み | ✓ | ✓ |
| 仕事ごとに最適なエージェントチームを自動編成 | — | ✓ |
| 価格 | 無料 | 未定 |

## コントリビュート

歓迎します。[CONTRIBUTING.md](CONTRIBUTING.md) をお読みください。すべてのコミットに DCO 署名（`git commit -s`）が必要で、CI で確認します。引用は [CITATION.cff](CITATION.cff) を参照してください。

## ライセンス

自社コードは [Apache License 2.0](LICENSE)（Copyright 2026 Slovian Inc）です。FastClaw には別途 FastClaw Community License が適用されます（[NOTICE](NOTICE) 参照）。Heybe は FastClaw、OpenAI、Anthropic、DeepSeek、Manus、xAI のいずれとも提携していません。
