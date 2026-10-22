# Heybe use cases: what a local AI assistant on your Mac can do

[README](../README.md) · [FAQ](faq.md) · [Website](https://heybe.dev)

> Heybe is in development (developer preview). Scenarios marked **v1** are in scope for the first preview; **later** ones are planned. Nothing here is available to download yet.

Heybe is a personal AI assistant that runs on your own computer. You describe the outcome; it plans the steps, does the work inside a sandbox, and asks before anything sensitive. Below are the jobs we design for, grouped by who they help.

## For everyday users

### Research and compare before you buy (v1)
> "Compare these five note apps: price, offline use, and where my data lives."

Heybe reads each product's site, builds a side-by-side table with a source for every cell, and gives a short recommendation. The report is saved as a file in your Heybe folder. Good for laptops, subscriptions, phone plans, or any "which one should I pick?" question.

### Summarize long reading (v1)
> "Summarize this article and the three pages it links to."

A short brief with the key points and links back to the originals, so you can check anything that matters.

### Plan a trip (v1)
> "Find flights and two hotel options for a weekend in Portland under $600."

Options gathered on one page. Heybe does not book or pay for anything; payments are out of scope for v1.

### Tidy up files, safely (v1)
> "Clean up my Drafts folder and get rid of old copies."

Heybe lists exactly which files it wants to move to the Trash and why, then waits for your click. You can untick files, edit the plan (for example, move to an Archive folder instead), or deny.

### Morning briefing (later)
> "Every morning at 8, send me what matters: news on my topics and today's calendar."

Scheduled tasks and delivery to your phone are planned after the first preview.

### Price watch (later)
> "Tell me if this monitor drops below $250."

## For solopreneurs and small teams

### Weekly recap (v1)
> "Turn this week's posts and site stats into a short recap with three ideas for next week."

### Meeting notes to updates (v1)
> "Turn these meeting notes into a weekly update with decisions, to-dos and owners."

A draft you edit and send yourself. Heybe never sends email or messages on its own in v1.

### Competitor check (v1)
> "What changed on these three competitors' pricing pages this month?"

### Chat from Telegram (later)
> Message Heybe from your phone while it works on your Mac.

Telegram first, other IM apps later. See the [roadmap](../README.md#roadmap-and-status).

## For developers

- **Self-hosted AI agent you can read.** Apache-2.0 TypeScript workspace: a typed FastClaw `/v1` client, a local task manager on SQLite, and a Tauri + React desktop shell.
- **Bring your own API key.** DeepSeek by default; OpenAI and Anthropic Claude with your key; Ollama for local chat.
- **Sandbox-first design.** One micro-VM per session (BoxLite on Apple Silicon, Lima as fallback), with an approval step for sensitive actions. See [sandbox-options.md](sandbox-options.md).
- **Honest task states.** Failures stay failures; uncertain results wait for review. See [flows-spec.md](flows-spec.md).

## What Heybe will not do in v1

- Send emails, post, or pay on your behalf.
- Turn the sandbox off.
- Run on Windows or Linux.
- Promise tool use with small local models.

Want to try it when it is ready? Join the waitlist at [heybe.dev](https://heybe.dev).
