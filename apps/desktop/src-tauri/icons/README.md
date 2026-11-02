# 占位图标

这里的图标是**占位图**（纯色底 + 字母 H），只为让 `tauri::generate_context!` 能编译、`tauri dev` / `tauri build` 能跑。
**正式图标由品牌方提供**，到时直接覆盖同名文件即可（PNG 必须是 RGBA）。

- 引用位置：`../tauri.conf.json` 的 `bundle.icon`；另有 `icon.png`（Tauri 默认窗口图标）。
- 重新生成占位图：`python3 scripts/dev/gen-placeholder-icons.py`（需要 Pillow）。
- 也可以用正式源图一次生成全套：`pnpm --filter @heybe/desktop tauri icon <1024x1024 源图.png>`。
- 检查：`apps/desktop/test/icons.test.ts`（`pnpm test` 会跑）确认每个引用的图标都在、PNG 为 RGBA。
