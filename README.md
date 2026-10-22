<!-- Heybe: open-source personal AI assistant for Mac (local AI agent, self-hosted, bring your own API key) -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe: open-source personal AI assistant that runs on your Mac" width="760"></a>
</p>

<h1 align="center">Heybe: open-source personal AI assistant for Mac</h1>

<p align="center"><b>Say it once. Heybe handles the rest.</b><br>
A local-first AI agent that runs on your own computer, works in a sandbox, and asks before it acts.<br>
Use DeepSeek out of the box or bring your own OpenAI or Claude API key.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: macOS (Apple Silicon)" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-black">
  <img alt="Status: developer preview in development" src="https://img.shields.io/badge/status-developer%20preview%20in%20development-orange">
  <a href="CONTRIBUTING.md"><img alt="DCO sign-off required" src="https://img.shields.io/badge/DCO-sign--off-green"></a>
  <a href="https://heybe.dev"><img alt="Website: heybe.dev" src="https://img.shields.io/badge/web-heybe.dev-E8453C"></a>
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (Brasil)</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **Status: developer preview in development. There is no download yet.** The screenshots below are design previews with sample content, not the shipping app.
> Join the waitlist at **[heybe.dev](https://heybe.dev)** or try the [clickable prototype](https://heybe.dev/demo).

## What is Heybe?

Heybe is a **private AI assistant that runs on your computer**. You tell it what you need in plain words, like you would ask a friend. It plans the steps, reads the web, writes the report or draft, and saves the result as a file on your Mac. It keeps working after you close the window.

It is built for people who have never used an "AI agent" before, and for solo founders and developers who want a **self-hosted AI assistant** they can inspect, change, and trust:

- **Runs on your Mac.** Your files, tasks, and history stay on your machine.
- **Works in a safe space.** Every action runs in an isolated sandbox by default, away from your personal files.
- **Asks before it acts.** Deleting files, writing outside its folder, or going over budget needs a click from you. Typing "yes" in the chat does not count.
- **Your choice of AI.** DeepSeek by default; bring your own OpenAI or Anthropic Claude API key; or run a local model with Ollama for offline chat.
- **Open source.** The Community edition is Apache-2.0. No account with us is needed to build or run it.

## Screenshots (design preview)

> Design previews from the v1 mockups. Sample content only; the real app may look different.

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Heybe desktop app screens overview: onboarding, chat, task progress, action approval, result report and settings" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Heybe onboarding: choose DeepSeek, bring your own OpenAI or Claude API key, or run a local model on your Mac" width="420"><br>**1. First run:** pick where the AI comes from (DeepSeek, your own key, or local). | <img src="docs/images/heybe-chat-plan.png" alt="Heybe chat: the local AI assistant turns one sentence into a step-by-step plan" width="420"><br>**2. Chat:** say it once, get a plan. It keeps going if you close the window. |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Heybe task progress: each step runs in a sandboxed safe space with a stop button and cost so far" width="420"><br>**3. Task in progress:** live steps, safe-space badge, Stop button, cost so far. | <img src="docs/images/heybe-action-approval.png" alt="Heybe action approval dialog: the AI agent asks before deleting files, with Deny, Edit and Approve" width="420"><br>**4. Approval:** sensitive actions wait for your click: Deny, Edit, or Approve. |
| <img src="docs/images/heybe-task-result-report.png" alt="Heybe task result: comparison table and recommendation with sources, saved as a local file" width="420"><br>**5. Result:** a finished report with sources, saved in your Heybe folder. | <img src="docs/images/heybe-settings-api-keys.png" alt="Heybe settings: AI providers and API keys, safety rules with the sandbox always on, chat apps like Telegram coming soon" width="420"><br>**6. Settings:** AI providers and keys, safety rules, chat apps (coming soon). |

## What can Heybe do?

Heybe is scenario-first. A few things you can hand off (see [docs/use-cases.md](docs/use-cases.md) for more):

| You say | Heybe does |
|---|---|
| "Compare these five note apps for me." | Visits each site, builds a side-by-side table with sources, and recommends one. |
| "Turn these meeting notes into a weekly update." | Pulls out decisions, to-dos and owners into a ready-to-edit draft. |
| "Summarize this article and the three it links to." | Reads the pages and writes a short brief with links. |
| "Tidy up my Drafts folder." | Finds old copies and asks before moving anything to the Trash. |
| "Research flights and hotels for a weekend in Portland." | Gathers options into one page you can review. |
| "Wrap up this week's site stats into a recap." *(solopreneurs)* | A short summary plus ideas for next week. |

Planned after the first preview: a morning briefing on a schedule, price watch, and chatting with Heybe from **Telegram** and other IM apps.

## Features

| Feature | Status |
|---|---|
| Desktop app for macOS (Tauri + React), Apple Silicon first | In development |
| Streaming chat with DeepSeek (default), OpenAI, Anthropic Claude (bring your own API key) | In development |
| Local models via Ollama (chat only, offline) | In development |
| Web search by reading pages directly, with cited sources | In development |
| Long-running tasks that survive closing the window (local task manager, SQLite) | Skeleton merged |
| Sandbox on by default: one micro-VM per session (BoxLite on Apple Silicon, Lima as fallback) | Proof of concept |
| Click-to-approve for sensitive actions (local writes, deletes, over budget) | In development |
| Cost and model-source shown for every task | In development |
| Signed and notarized DMG from heybe.dev (no Mac App Store) | Planned |
| Long-term memory you can see, edit and delete | Planned for v1.1 |
| Telegram and other chat apps | Planned |
| Dynamic agent teams | Heybe Pro (later) |

## How Heybe compares

Heybe sits between cloud agents (easy, but your work runs on someone else's servers) and developer tools (powerful, but built for the terminal). The table is a good-faith summary of public information as of October 2026; products change fast, so check each vendor's own docs.

| | Where it runs | Source | Models | Safety model | Chat apps |
|---|---|---|---|---|---|
| **Heybe** (in development) | Your Mac | Open source (Apache-2.0); optional Pro later | DeepSeek, OpenAI, Claude (your key), Ollama | Sandbox on by default + click to approve | Telegram planned |
| [ChatGPT](https://chatgpt.com) (Work / cloud browser) | OpenAI's cloud; desktop and mobile apps | Proprietary | OpenAI | Asks before visiting new sites and before consequential actions | — |
| [Claude](https://claude.com) desktop (Cowork) | Desktop app (macOS, Windows); code runs in a local VM; cloud sessions available | Proprietary | Anthropic Claude | Folder access you grant; asks before sensitive actions | — |
| [Manus](https://manus.im) | Cloud agent; desktop app can work in folders you approve | Proprietary | Manus-managed | Approval for each local command | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | Your machine or server (macOS, Windows, Linux) | Open source (MIT) | Hosted or local | Optional sandbox (e.g. Docker) | 20+ channels |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | Self-hosted multi-agent runtime | Source-available (FastClaw Community License) | Hosted or local | Sandbox backends | Several channels |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | Your terminal | Open source (Apache-2.0) | Hosted or local | Asks before running code | — |
| [Jan](https://jan.ai) | Desktop app | Open source (Apache-2.0) | Local (llama.cpp) and cloud APIs | Chat-first; tool calls need approval | — |
| [LM Studio](https://lmstudio.ai) | Desktop app | Proprietary, free for home and work | Local models | Chat-first | — |

**Why pick Heybe?** If you want a *Manus alternative* or *ChatGPT agent alternative* that runs on your own Mac, is open source, lets you bring your own API key, and puts a sandbox plus an approval click between the AI and your files.
**Why not (yet)?** Heybe is not released. If you need something today, the tools above are mature and well documented.

Heybe runs on top of FastClaw through its `/v1` API; FastClaw is not part of this repository (see [NOTICE](NOTICE)). All product names and trademarks belong to their respective owners. Heybe is not affiliated with or endorsed by any of them.

## Privacy and safety

These are the design rules for v1; each one gets a test before the preview ships.

- **Local by default.** Tasks, files and history live on your Mac. Prompts go only to the AI provider you choose, or nowhere if you use a local model.
- **Keys stay yours.** API keys are stored in the macOS Keychain, never in the repo, logs or exports.
- **Sandbox always on.** There is no "turn off the sandbox" mode in v1. Actions run inside an isolated micro-VM, and web reading is designed to run inside it too.
- **Approval card, not chat text.** Sensitive actions show exactly what will happen and whether it can be undone. Nothing happens until you click.
- **Honest results.** A failed step is shown as failed, never as done. Unclear results wait in "needs your review".

## Roadmap and status

| Stage | What | Status |
|---|---|---|
| 0 | Repo, FastClaw `/v1` adapter, sandbox proof of concept, interface checks | In progress |
| 1 | Desktop chat, providers and keys, web reading, tasks with results | In progress |
| v1 developer preview | Build from source on macOS (Apple Silicon) | Not yet available |
| v1.1 | Long-term memory | Planned |
| Later | Telegram and IM apps, schedules, multi-agent teams, signed DMG at heybe.dev | Planned |

Follow progress in [milestones](https://github.com/Slovian42/Heybe/milestones) and [issues](https://github.com/Slovian42/Heybe/issues). Get notified at **[heybe.dev](https://heybe.dev)**.

## Quick start for developers

What works in the repo today is the TypeScript workspace (adapter, task manager, placeholder desktop shell) and its tests. There is no end-to-end app yet.

```bash
# Requires Node 20+ and pnpm 10 (corepack enable)
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + boundary checks + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # placeholder UI at http://localhost:1420
```

Setting up FastClaw and the sandbox: [docs/phase0-dev-env.md](docs/phase0-dev-env.md), [docs/sandbox-options.md](docs/sandbox-options.md), [docs/poc-boxlite.md](docs/poc-boxlite.md). Never put real keys in files: copy `.env.example` to `.env` (git-ignored) for local values.

### Repository layout

| Path | What |
|---|---|
| `apps/desktop` | Tauri 2 + React desktop app (placeholder shell) |
| `apps/website` | Source of [heybe.dev](https://heybe.dev) (Cloudflare Worker + static pages) |
| `services/task-manager` | Local task manager: TypeScript + SQLite (tasks, steps, approvals, receipts) |
| `packages/fastclaw-adapter` | Typed FastClaw client, **`/v1/*` only** (enforced by lint) |
| `packages/shared-types` | Shared types, including the versioned interface used by Pro |
| `docs/` | [Architecture](docs/architecture.md), [v1 scope](docs/v1-scope.md), [flows](docs/flows-spec.md), [use cases](docs/use-cases.md), [FAQ](docs/faq.md) |

## FAQ

<details><summary><b>Is there an open-source AI assistant that runs locally on a Mac?</b></summary>
Heybe is being built to be exactly that: an Apache-2.0 personal AI assistant that runs on your Mac, with a sandbox on by default. It is in development and not yet downloadable.</details>

<details><summary><b>Is Heybe a free Manus alternative?</b></summary>
Heybe Community is free and open source. Unlike cloud agents, it runs the work on your own computer. You pay only your AI provider (for example DeepSeek), or nothing with a local model.</details>

<details><summary><b>Can I use my own OpenAI or Claude API key?</b></summary>
Yes. Bring your own key for OpenAI or Anthropic Claude; DeepSeek is the default. Keys are stored in the macOS Keychain.</details>

<details><summary><b>Does Heybe work offline with local models?</b></summary>
Chat with a local model through Ollama is planned for v1. Tool use with local models is not promised, because small models are not reliable enough for it yet.</details>

<details><summary><b>Is it safe to let an AI agent act on my computer?</b></summary>
Heybe runs actions in an isolated sandbox by default and asks for a click before anything sensitive. You can stop a task at any time.</details>

<details><summary><b>Can I chat with Heybe from Telegram?</b></summary>
Not yet. Telegram and other chat apps are planned after the first preview.</details>

<details><summary><b>Does it run on Windows or Linux?</b></summary>
Not in v1. Mac (Apple Silicon first) only.</details>

More: [docs/faq.md](docs/faq.md).

## Community and Pro

| | Heybe Community | Heybe Pro (later) |
|---|---|---|
| License | Apache-2.0, this repo | Proprietary, Slovian Inc |
| Assistant, tasks, sandbox, approvals, bring your own key | ✓ | ✓ |
| Dynamic teams that assemble the right agents for each job | — | ✓ |
| Price | Free | Not announced |

Community never depends on Pro: it builds and runs on its own.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md). Every commit needs a DCO sign-off (`git commit -s`); CI checks it. Please keep PRs small, never commit secrets, and open an [issue](https://github.com/Slovian42/Heybe/issues) to discuss bigger changes.

If you cite Heybe, see [CITATION.cff](CITATION.cff).

## License

Our own code is licensed under the [Apache License 2.0](LICENSE), Copyright 2026 Slovian Inc. FastClaw is separately governed by the FastClaw Community License; see [NOTICE](NOTICE). Heybe is not affiliated with FastClaw, OpenAI, Anthropic, DeepSeek, Manus, or xAI.

