# #19 T1.3.1 Tauri 壳 + React 流式聊天（第一部分）

本 PR 覆盖拆分文档 `docs/design/phase1-split-19-16.md` 中的 19-a、19-c（关窗隐藏部分）、19-d、19-e、19-f（纯文本安全渲染）。

## 结构

```
React（apps/desktop） --POST /chat/sessions/:id/messages (SSE)--> Heybe 本地服务（services/task-manager，仅 127.0.0.1）
                                                                 --/v1/chat/completions (SSE)--> FastClaw gateway
```

- 前端只连本地服务，不连 FastClaw，不加载 FastClaw `web/`；CSP 只允许 `self` 与 `http://127.0.0.1:*`。
- 服务端事件：`delta` / `tool`（running/done）/ `done` / `error`（interrupted=中断，结果未知；failed=没做成；unavailable），总以 `data: [DONE]` 结束。错误不透传上游原文。
- 会话键 `heybe:chat:<id>`。停止 = 前端断开 → 服务立刻断开上游；状态显示“已停止（服务端是否停止未知）”，下一轮前提示上一轮可能仍被补完（v1.4.0 无 /v1 stop，#9）。
- 关窗 = 隐藏窗口，点 Dock 图标恢复；Cmd+Q 退出。开机自启默认关（D9，本 PR 不加登录项）。

## 后续（不在本 PR）

- 19-b：sidecar 起服务/gateway、随机端口+令牌经 IPC 交给前端、健康检查与崩溃重启。现在前端读 `VITE_HEYBE_SERVICE_URL`（只接受 `http://127.0.0.1:<port>`），服务入口需手动传 `chat: fastClawChatStream(client, agentId)` 启动。
- 19-c 余下：菜单栏图标、退出时停服务与 gateway、无残留进程。
- 19-f 余下：Markdown 渲染（禁原始 HTML）、1 万字虚拟滚动/分块。
- 19-g：首启引导（依赖 #16-c、#6）。
- 19-h：arm64 DMG 签名公证（依赖 Slovian Inc Apple 开发者账号）。

## Mac 验收步骤（Apple 芯片）

前提：Xcode Command Line Tools、Rust（`rustup target add aarch64-apple-darwin`）、Node 20、pnpm。

1. `git fetch && git checkout feat/19-tauri-chat && pnpm install && pnpm lint && pnpm test`
2. 本地起 FastClaw gateway（按 docs/poc-boxlite.md），再起 Heybe 服务并开启聊天路由（19-b 之前需手动，脚本另行提供）。
3. `cd apps/desktop && VITE_HEYBE_SERVICE_URL=http://127.0.0.1:<服务端口> pnpm tauri dev`
4. 检查：
   - 发一句话，回复逐字出现；有工具调用时“工具步骤”可展开，`web_fetch` 等标 ⚠。
   - 回复中点“停止”，≤300 ms 不再出字，显示“已停止（服务端是否停止未知）”。
   - 发送 `<img src=x onerror=alert(1)>` 让它原样复述，不弹窗。
   - 关闭窗口后进程仍在（活动监视器），点 Dock 图标窗口恢复；Cmd+Q 退出。
   - Web 检查器（右键→检查）Network 里没有 FastClaw `web/` 或外部地址请求。
5. `pnpm -C apps/desktop tauri:build:mac`，然后 `lipo -archs src-tauri/target/aarch64-apple-darwin/release/heybe-desktop` 显示 `arm64`（未签名内部构建）。
