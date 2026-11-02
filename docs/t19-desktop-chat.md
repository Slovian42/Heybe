# #19 T1.3.1 Tauri 壳 + React 流式聊天

PR #83 覆盖拆分文档 `docs/design/phase1-split-19-16.md` 中的 19-a、19-b、19-c（菜单栏图标除外）、19-d、19-e、19-f（纯文本安全渲染）。

## 结构

```
React（apps/desktop） --POST /chat/sessions/:id/messages (SSE)--> Heybe 本地服务（services/task-manager，仅 127.0.0.1）
                                                                 --/v1/chat/completions (SSE)--> FastClaw gateway
```

- 前端只连本地服务，不连 FastClaw，不加载 FastClaw `web/`；CSP 只允许 `self` 与 `http://127.0.0.1:*`。
- 服务端事件：`delta` / `tool`（running/done）/ `done` / `error`（interrupted=中断，结果未知；failed=没做成；unavailable），总以 `data: [DONE]` 结束。错误不透传上游原文。
- 会话键 `heybe:chat:<id>`。停止 = 前端断开 → 服务立刻断开上游；状态显示“已停止（服务端是否停止未知）”，下一轮前提示上一轮可能仍被补完（v1.4.0 无 /v1 stop，#9）。
- 告警工具（界面上标“需要留意”）= `FASTCLAW_ALERT_TOOLS`（`packages/shared-types/src/chat.ts`，前端与任务服务共用一份）：
  - 来自 #67（Agent 管理类）：`create_agent` `configure_agent` `check_agent` `delete_agent` `spawn_subagent` `delegate_task` `install_skill`；
  - 来自 `docs/t043` §3（定时任务）：`create_cron_job` `delete_cron_job`。
  - 第一部分里的旧名单（`web_fetch`、`exec` 等）没有出处，已删除。
- 关窗 = 隐藏窗口，点 Dock 图标恢复；Cmd+Q 退出。开机自启默认关（D9，本 PR 不加登录项）。

## 19-b 本地服务与进程管理

```
Tauri 壳（src-tauri/src/service.rs，Supervisor）
  └─ 独立进程组：Heybe 本地服务（services/task-manager/src/main.ts）
        └─ FastClaw gateway（HEYBE_FASTCLAW_GATEWAY_BIN，环境变量走白名单，不带模型密钥）
```

- 壳每次启动生成 64 位十六进制随机令牌，服务监听 `127.0.0.1` 随机端口（`HEYBE_SERVICE_PORT=0`），就绪时在标准输出打一行 `HEYBE_SERVICE_READY {"port":N}`（不含令牌）。
- 前端只通过 Tauri 命令 `service_info` 拿 `{status,url,token}`，请求带 `Authorization: Bearer`；除 `GET /health` 外没令牌一律 401（常量时间比较）。
- 服务启动时先拉起 gateway 并等 `/healthz`（最长 30 秒）；聊天接口默认开启（Agent = `HEYBE_FASTCLAW_AGENT_ID`，不设则用 `/v1/agents` 第一个）。
- 崩溃重启：服务退出，或 `/health` 连续 3 次（每 2 秒一次）失败 → 杀整个进程组 → 退避 0.5/1/2/4/8 秒重启；界面显示“本地服务断开，正在重连…”，好了自动消失。
- 退出（Cmd+Q）：壳给进程组发 SIGTERM，3 秒后 SIGKILL；服务收到 SIGTERM / 标准输入关闭（壳意外死掉）都会先停 gateway。gateway 自己挂了，服务也跟着退出并由壳重启。
- 开发版命令：debug 构建用 `pnpm -C services/task-manager start`（tsx）；可用 `HEYBE_SERVICE_CMD` 覆盖。发布版打包成 sidecar 留给 19-h。
- 一键开发脚本：`scripts/dev/heybe-desktop-dev.sh`（预检 → 首次自动跑 `scripts/poc/t021-mac.sh` 准备 FastClaw + DeepSeek → `pnpm install` → `pnpm tauri dev`）；`… check` 检查残留进程。

- 图标：`apps/desktop/src-tauri/icons/` 目前是**占位图标**（纯色底 + H，RGBA），正式图标由品牌方提供后覆盖同名文件（见该目录 `README.md`）。缺图标时 `generate_context!` 编译期 panic，`apps/desktop/test/icons.test.ts` 检查 `tauri.conf.json` 引用的图标都在。

## 后续（不在本 PR）

- 19-c 余下：菜单栏图标。
- 19-f 余下：Markdown 渲染（禁原始 HTML）、1 万字虚拟滚动/分块。
- 19-g：首启引导（依赖 #16-c、#6）。
- 19-h：sidecar 打包、arm64 DMG 签名公证（依赖 Slovian Inc Apple 开发者账号）。

## Mac 验收步骤（Apple 芯片）

前提：`~/.heybe-poc.env` 里有 `DEEPSEEK_API_KEY=…`，权限 600（`chmod 600 ~/.heybe-poc.env`）；装了 Xcode 命令行工具、Node 20+、pnpm、Rust。

1. 启动：
   ```bash
   cd Heybe && git fetch && git checkout feat/19-tauri-chat && git pull
   scripts/dev/heybe-desktop-dev.sh
   ```
   终端应看到一串 `✓`；首次会自动跑 t021（下载 FastClaw、配置 DeepSeek Agent）和编译 Rust，需几分钟。
2. 看窗口：弹出 “Heybe” 窗口，顶部黄条“正在启动本地服务…”在约 10 秒内消失，发送按钮可点。
   - 成功标准：黄条消失；终端没有红色 `✗`。
3. 聊天：输入“用三句话介绍你自己”回车。
   - 成功标准：回答逐字流出，结束后不再闪光标；再问“我刚才让你做什么？”能答出上一轮内容（同一会话）。
4. 停止：问一个长问题（“写一篇 800 字的文章”），流出一半点“停止”。
   - 成功标准：立即停住，显示“已停止（服务端是否停止未知）”；还能继续发下一条。
5. 崩溃重启：另开终端执行 `pkill -9 -f services/task-manager/src/main.ts`。
   - 成功标准：窗口出现“本地服务断开，正在重连…”，10 秒内消失；再发一条消息能正常回答。
6. 关窗与退出：点窗口左上角红色关闭 → 窗口消失但 Dock 图标还在；点 Dock 图标 → 窗口回来，聊天记录还在。然后按 Cmd+Q。
   - 成功标准：终端里 `pnpm tauri dev` 结束；再执行 `scripts/dev/heybe-desktop-dev.sh check` 输出 `✓ 没有残留进程，端口 18963 已释放`。
7. 安全检查（可选）：`curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:<端口>/chat/sessions/x/messages`（端口见终端 `heybe: service ready on 127.0.0.1:<端口>` 行）应返回 `401`。

有任何一步不符合，请把终端最后 30 行（不含密钥，脚本本身不会打印密钥）和截图发到 #19。
