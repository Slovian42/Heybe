# 阶段 0 开发环境清单（macOS）

适用：用户的 Mac（Apple Silicon 优先，Intel 同理）。所有密钥只放钥匙串或本机环境变量，不写入仓库、日志或截图。

## 0. 固定的 FastClaw 版本

| 项 | 值 |
|---|---|
| 版本 | **v1.4.0**（GitHub 最新 release，查询于 2026-10-22） |
| Tag commit | `b5ad3dff1f230d692e4e1d5ad9ce486f24749964` |
| 发布时间 | 2026-10-14 12:27（UTC+8） |
| Release | https://github.com/fastclaw-ai/fastclaw/releases/tag/v1.4.0 |
| darwin_arm64 SHA-256 | `d8d683aed3afdd1cf920d522bc92194ce3680370154ca069f7301d78ebec6308` |
| darwin_amd64 SHA-256 | `f11e74308c420770f2179627f3be872c4d1af6e2293b199b13871b6f7e15a8fa` |

> SHA-256 由我们于 2026-10-22 下载 release 资产自行计算；上游未发布 checksum 文件。
> ⚠️ 官方 `install.sh` 总是安装 **latest**，不能用来固定版本，请按下面手动安装。

## 1. 安装清单

1. **Xcode Command Line Tools**：`xcode-select --install`
2. **Homebrew**：按 https://brew.sh 官方命令安装
3. **Node LTS（20）+ pnpm**
   ```bash
   brew install fnm && fnm install 20 && fnm use 20   # 仓库含 .nvmrc
   corepack enable && corepack prepare pnpm@10.34.6 --activate
   ```
4. **Rust + Tauri 依赖**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # 或 brew install rustup
   rustup default stable
   # Tauri 2 在 macOS 只需 Xcode CLT + Rust；完整 Xcode 仅在打包签名时需要
   ```
5. **OrbStack（沙箱用）**：`brew install --cask orbstack`，启动后确认 `docker info` 可用。
6. **FastClaw v1.4.0（固定版本）**
   ```bash
   V=v1.4.0; ARCH=$(uname -m | sed 's/x86_64/amd64/')
   mkdir -p ~/.local/opt/fastclaw/$V ~/.local/bin && cd /tmp
   curl -fLO https://github.com/fastclaw-ai/fastclaw/releases/download/$V/fastclaw_darwin_${ARCH}.tar.gz
   shasum -a 256 fastclaw_darwin_${ARCH}.tar.gz      # 与上表比对，不一致则停止
   tar -xzf fastclaw_darwin_${ARCH}.tar.gz -C ~/.local/opt/fastclaw/$V
   ln -sfn ~/.local/opt/fastclaw/$V/fastclaw ~/.local/bin/fastclaw
   fastclaw --version   # 若无此子命令，用 `fastclaw version` 或 `fastclaw -h` 查看
   ```
7. **FastClaw 运行配置**（仅环境变量，见 `.env.example`）
   ```bash
   export FASTCLAW_HOME=~/.fastclaw          # 默认
   export FASTCLAW_BIND=loopback             # 只听 127.0.0.1
   export FASTCLAW_PORT=18953
   export FASTCLAW_SANDBOX_ENFORCE=1         # 默认强制沙箱
   export FASTCLAW_SANDBOX_BACKEND=docker    # OrbStack 提供 docker
   ```
   API key：控制台 → API Keys 创建一次（只显示一次），存入钥匙串：
   `security add-generic-password -s opengrok-fastclaw -a "$USER" -w`（交互输入，不进 shell 历史），
   使用时 `export FASTCLAW_API_KEY=$(security find-generic-password -s opengrok-fastclaw -w)`。
8. **Ollama（本地模型，只验证基础对话）**：`brew install ollama && ollama serve`，
   拉一个小模型如 `ollama pull qwen2.5:7b`；工具调用不在阶段 0 验证范围。

## 2. 升级与回退

- 每个版本装在 `~/.local/opt/fastclaw/<tag>/`，`~/.local/bin/fastclaw` 只是软链。
- 升级前：`fastclaw daemon stop`（若已注册服务）→ 备份 `cp -a ~/.fastclaw ~/.fastclaw.bak-$(date +%Y%m%d-%H%M)`（含 SQLite，注意 `FASTCLAW_STORAGE_AUTO_MIGRATE` 默认会迁移库）。
- 升级：按第 6 步装新 tag，改软链，跑第 3 节校验 + `pnpm test`，更新本文与 `docs/interface-verification.md` 的版本号。
- 回退：软链指回旧 tag，并用备份目录替换 `~/.fastclaw`（迁移后的库不保证被旧版读取）。
- 升级须 PR 评审；适配层只用 `/v1/*`，降低升级破坏面。

## 3. 校验步骤

```bash
xcode-select -p && brew --version && node -v && pnpm -v && rustc --version && cargo --version
docker info >/dev/null && echo "OrbStack/docker OK"
fastclaw --version   # 若无此子命令，用 `fastclaw version` 或 `fastclaw -h` 查看                     # 期望 v1.4.0
fastclaw daemon start                  # 首次运行可先前台 `fastclaw` 走向导
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18953/   # 期望 200/302
curl -s http://127.0.0.1:18953/v1/agents -H "Authorization: Bearer $FASTCLAW_API_KEY" | head -c 200
curl -s http://127.0.0.1:11434/api/tags | head -c 200   # Ollama 自身接口，非 FastClaw
cd opengrok-community && pnpm install && pnpm lint && pnpm test
```
沙箱越权实测（读宿主文件、访问未授权网络）属于第一轮任务 4，结果记录到 `docs/interface-verification.md` 第 5 行。
