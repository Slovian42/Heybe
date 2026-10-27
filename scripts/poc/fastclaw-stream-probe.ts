/**
 * 用 @heybe/fastclaw-adapter 发一次流式对话，输出一行 JSON 摘要（不含任何密钥）。
 * 供 scripts/poc/fastclaw-lab.sh restart 使用：收到第一段正文后创建 HEYBE_PROBE_MARK 文件，
 * 外部脚本据此杀掉 / 重启 gateway，观察适配层看到什么。
 *
 * 环境变量：HEYBE_FASTCLAW_BASE_URL、HEYBE_FASTCLAW_CHAT_TOKEN（或旧名 HEYBE_FASTCLAW_TOKEN）、HEYBE_PROBE_AGENT、
 *          HEYBE_PROBE_SESSION、HEYBE_PROBE_PROMPT、HEYBE_PROBE_MARK（可选）。
 * 运行：pnpm dlx tsx scripts/poc/fastclaw-stream-probe.ts
 */
import { writeFileSync } from "node:fs";

import {
  FastClawClient,
  FastClawError,
} from "../../packages/fastclaw-adapter/src/index.ts";

async function main(): Promise<void> {
  const env = process.env;
  const client = new FastClawClient({
    baseUrl: env.HEYBE_FASTCLAW_BASE_URL ?? "",
    token: env.HEYBE_FASTCLAW_CHAT_TOKEN ?? env.HEYBE_FASTCLAW_TOKEN ?? "",
    timeoutMs: 300_000,
    retry: { maxAttempts: 1 },
  });
  const session = client.createSession({
    agentId: env.HEYBE_PROBE_AGENT ?? "",
    sessionKey: env.HEYBE_PROBE_SESSION,
  });
  const out = {
    deltas: 0,
    chars: 0,
    tools: 0,
    done: false,
    finishReason: null as string | null,
    completedNormally: false,
    error: null as null | {
      name: string;
      kind: string | null;
      code: string | null;
      message: string;
      cause: string | null;
    },
  };
  let marked = false;
  try {
    for await (const ev of client.streamMessage(session, {
      messages: [
        { role: "user", content: env.HEYBE_PROBE_PROMPT ?? "只回复 OK" },
      ],
    })) {
      if (ev.type === "delta") {
        out.deltas += 1;
        out.chars += ev.content.length;
        if (!marked && env.HEYBE_PROBE_MARK && out.chars >= 20) {
          writeFileSync(env.HEYBE_PROBE_MARK, "1");
          marked = true;
        }
      } else if (ev.type === "tool") out.tools += 1;
      else if (ev.type === "done") {
        out.done = true;
        out.finishReason = ev.finishReason;
      }
    }
    out.completedNormally = true;
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    out.error = {
      name: e?.name ?? typeof err,
      kind: err instanceof FastClawError ? err.kind : null,
      code: err instanceof FastClawError ? (err.code ?? null) : null,
      message: String(e?.message ?? err).slice(0, 200),
      cause: e?.cause
        ? String((e.cause as Error)?.message ?? e.cause).slice(0, 200)
        : null,
    };
  }
  console.log(JSON.stringify(out));
}

void main();
