# Heybe FAQ

[README](../README.md) · [Use cases](use-cases.md) · [Website](https://heybe.dev)

Common questions about Heybe, the open-source personal AI assistant for Mac. Heybe is in development; answers describe the v1 developer preview plan.

### What is Heybe?
A private AI assistant that runs on your own Mac. You say what you need; it plans, researches, writes, and saves the result as a file. Sensitive actions need your click.

### Is Heybe open source and free?
Heybe Community is open source under Apache-2.0 and free. A paid Heybe Pro edition with dynamic agent teams is planned; pricing is not announced.

### Can I download Heybe today?
No. The developer preview is in development. Join the waitlist at [heybe.dev](https://heybe.dev) or try the [clickable design prototype](https://heybe.dev/demo).

### Is Heybe a local AI agent or a cloud service?
Local. The app, your tasks and files live on your Mac. The "thinking" is done by the AI provider you pick (DeepSeek by default, or OpenAI / Claude with your own key), or by a local model through Ollama.

### Can I bring my own API key?
Yes: OpenAI and Anthropic Claude keys are supported in the plan, alongside the default DeepSeek. Keys are kept in the macOS Keychain and never written to logs or the repo.

### Does Heybe work offline?
Chatting with a local model through Ollama is planned for v1 and works offline. Web research obviously needs the internet. Tool use with local models is not promised in v1.

### How is Heybe different from ChatGPT, Claude desktop or Manus?
Those are excellent hosted products. Heybe runs the work on your own computer, is open source, lets you choose the model, and keeps a sandbox plus a click-to-approve step between the AI and your files. See the comparison in the [README](../README.md#how-heybe-compares).

### Is Heybe an OpenClaw alternative?
Both are self-hosted assistants. OpenClaw (MIT) is a gateway that connects many chat apps to agents and targets developers and power users. Heybe is a Mac desktop app for people without agent experience, with the sandbox always on. Heybe is built on FastClaw, a separate project.

### Is it safe to let an AI act on my computer?
Heybe is designed so that actions run in an isolated micro-VM by default, and anything sensitive (deleting, writing outside its folder, going over budget) waits for your click. Typing "yes" in chat does not count as approval. You can stop any task.

### Does Heybe send emails or post for me?
Not in v1. Sending, posting and payments are out of scope for the first preview.

### Can I use Heybe from Telegram?
Planned after the first preview. Telegram comes first, then other IM apps.

### Does Heybe remember things about me?
Long-term memory is planned for v1.1, with the ability to see, edit and delete anything it remembers.

### Which Macs are supported?
macOS on Apple Silicon first. Windows and Linux desktop apps are not planned for v1.

### Where will I download it?
Only from [heybe.dev](https://heybe.dev), as a signed and notarized DMG. Heybe will not be on the Mac App Store.

### Who makes Heybe?
Slovian Inc. Heybe is not affiliated with FastClaw, OpenAI, Anthropic, DeepSeek, Manus or xAI. All trademarks belong to their owners.

### How can I contribute?
Read [CONTRIBUTING.md](../CONTRIBUTING.md). Every commit needs a DCO sign-off (`git commit -s`).
