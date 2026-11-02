# T1.4.3 产物目录与待验收流程（#23）

> 2026-11-02（UTC+8）。代码：`services/task-manager/src/review.ts`、`artifacts.ts`、`fastclaw-executor.ts`、`http.ts`。

## 规则

1. **分目录**：产物写到 `<产物根>/<taskId>/<attemptId>/<文件名>`（目录 700、文件 600，原子改名）。重试是新的 attempt，新目录，不覆盖上一次；`artifacts` 表里同一任务同名文件 `version` 递增（1、2、3…）。
2. **校验值**：写盘时算 sha256，写进 `artifacts.sha256`，事件 `artifact_recorded` / `artifact_saved` 也带上。
3. **Agent 说完成只进待验收**：状态机禁止 `running → completed`，执行器（FastClaw 或 mock）报完成只能进 `awaiting_review`。
4. **缺文件不能标成功**：人工验收 `acceptNode` 先核对最新一次 attempt：
   - 任务 `deliverables` 里像文件名的项（如 `report.md`）都要有记录（`artifact_not_recorded`）；
   - 文件还在（`artifact_file_missing`）；
   - 重算 sha256 与入库一致（`artifact_checksum_mismatch`）。
   任一项不过：节点转 `needs_check`，记 `review_blocked` 事件，HTTP 返回 422；不会变成 `completed`。全部通过：节点 `completed`，这些产物标 `official = 1`，记 `review_accepted`。
5. **退回**：`rejectNode` 带 `rework: true` 回到 `pending` 重新执行；否则 `failed`。

## 本机 HTTP（仅 127.0.0.1）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tasks/:id/artifacts` | 产物列表（路径、sha256、版本、是否正式） |
| GET | `/nodes/:id/review` | 预检：现在验收会不会通过、缺什么 |
| POST | `/nodes/:id/accept` | `{note?}`；通过 200，不通过 422（节点已转 needs_check） |
| POST | `/nodes/:id/reject` | `{reason?, rework?}` |

## 验收方法（box 即可）

```bash
pnpm install && pnpm lint && pnpm test
# 重点：services/task-manager/test/review.test.ts
```

## 已知限制

- `deliverables` 是自由文本，只有形如 `name.ext` 的项被当作必交文件；其余（如“一份摘要”）不参与文件核对。
- 任务整体状态（tasks.status）不随节点自动汇总，留给后续任务汇总逻辑（#24 展示层）。
