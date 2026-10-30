/**
 * T0.2.2 Ollama 本地模型 3 轮流式对话（经 @heybe/fastclaw-adapter /v1）。
 *
 * 同一个 session key 连发 3 轮。FastClaw v1.4.0 的 /v1/chat/completions 只取请求里最后一条
 * user 消息，历史由服务端按 X-Fastclaw-Session-Key 保存（internal/api/openai.go:380–410），
 * 所以第 3 轮能答出第 1 轮的暗号 = FastClaw 会话上下文真的保留了。
 *
 * 环境变量（必填）：
 *   HEYBE_FASTCLAW_BASE_URL      例 http://127.0.0.1:18973
 *   HEYBE_FASTCLAW_CHAT_TOKEN    FastClaw 对话 API key（绝不打印）
 * 可选：
 *   HEYBE_FASTCLAW_AGENT_ID      指定 Agent；省略则取 listAgents 的第一个
 *   HEYBE_T022_TURN_TIMEOUT_MS   每轮超时，默认 300000（本地模型首次加载较慢）
 *
 * 输出：一段 JSON（不含 token；只含回复的前 60 个字符用于排查）。全部通过 exit 0，否则 exit 1。
 * 不验证工具调用（T0.2.2 范围外），只记录出现了几次 tool 事件。
 */

import {
  FastClawConfigError,
  FastClawError,
  fastClawClientFromEnv,
  type FastClawClient,
} from "../../packages/fastclaw-adapter/src/index.ts";

const SECRET_WORD = "蓝鲸7319";
const TURNS = [
  `请记住这个暗号：${SECRET_WORD}。不要使用任何工具，只回复“记住了”。`,
  "不要使用任何工具。1 加 2 等于几？只回答一个数字。",
  "不要使用任何工具。我在第一轮告诉你的暗号是什么？请把那个暗号原样写出来。",
];
const TIMEOUT_MS = Number(process.env.HEYBE_T022_TURN_TIMEOUT_MS) || 300_000;

interface Turn {
  turn: number;
  stream_ok: boolean;
  first_token_ms: number | null;
  total_ms: number;
  reply_chars: number;
  reply_head: string;
  tool_events: number;
  error_code: string | null;
}

interface Report {
  ok: boolean;
  agent_id: string | null;
  turns: Turn[];
  recall_ok: boolean | null;
  error_code: string | null;
  note: string;
}

function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bfc_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function finish(report: Report): never {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

function errCode(err: unknown): string {
  if (err instanceof FastClawError) return err.code ?? err.kind;
  return "unknown";
}

async function runTurn(client: FastClawClient, session: ReturnType<FastClawClient["createSession"]>, n: number): Promise<Turn> {
  const t0 = Date.now();
  let first: number | null = null;
  let reply = "";
  let tools = 0;
  let done = false;
  let code: string | null = null;
  try {
    for await (const ev of client.streamMessage(session, {
      messages: [{ role: "user", content: TURNS[n - 1] }],
      timeoutMs: TIMEOUT_MS,
    })) {
      if (ev.type === "delta" && ev.content) {
        if (first === null) first = Date.now() - t0;
        reply += ev.content;
      } else if (ev.type === "tool") {
        tools += 1;
      } else if (ev.type === "done") {
        done = true;
      }
    }
    if (!done && first !== null) done = true;
    if (!done) code = "empty_stream";
  } catch (err) {
    code = errCode(err);
  }
  const head = redact(reply.replace(/\s+/g, " ").trim()).slice(0, 60);
  return {
    turn: n,
    stream_ok: done && code === null,
    first_token_ms: first,
    total_ms: Date.now() - t0,
    reply_chars: reply.length,
    reply_head: head,
    tool_events: tools,
    error_code: code,
  };
}

async function main(): Promise<void> {
  const report: Report = { ok: false, agent_id: null, turns: [], recall_ok: null, error_code: null, note: "" };
  let client: FastClawClient;
  try {
    client = fastClawClientFromEnv(process.env, { timeoutMs: TIMEOUT_MS, retry: { maxAttempts: 1 } });
  } catch (err) {
    if (err instanceof FastClawConfigError) {
      finish({ ...report, error_code: "poc_preflight", note: `缺少环境变量：${err.missing.join(", ")}` });
    }
    throw err;
  }
  try {
    await client.health({ timeoutMs: 5_000 });
  } catch (err) {
    finish({ ...report, error_code: errCode(err), note: "连不上 FastClaw gateway" });
  }
  let agentId = process.env.HEYBE_FASTCLAW_AGENT_ID?.trim() || "";
  if (!agentId) {
    const list = await client.listAgents({ limit: 20 });
    agentId = list.agents[0]?.id ?? "";
  }
  if (!agentId) finish({ ...report, error_code: "no_agent", note: "GET /v1/agents 没有 Agent" });
  report.agent_id = agentId;

  const session = client.createSession({ agentId });
  for (let n = 1; n <= TURNS.length; n++) {
    const t = await runTurn(client, session, n);
    report.turns.push(t);
    if (!t.stream_ok) {
      finish({ ...report, error_code: t.error_code ?? "unknown", note: `第 ${n} 轮流式未成功` });
    }
  }
  const last = report.turns[2];
  report.recall_ok = last.reply_head.includes("7319") || last.reply_head.includes("蓝鲸");
  if (!report.recall_ok) {
    finish({ ...report, error_code: "context_lost", note: "第 3 轮没有答出第 1 轮的暗号" });
  }
  finish({ ...report, ok: true, note: "3 轮流式成功，第 3 轮答出了第 1 轮的暗号" });
}

main().catch((err) => {
  console.log(
    JSON.stringify({ ok: false, turns: [], recall_ok: null, error_code: "unknown", note: redact(err instanceof Error ? err.message : String(err)) }, null, 2),
  );
  process.exit(1);
});
