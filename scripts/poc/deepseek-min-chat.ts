/**
 * DeepSeek 最小对话 PoC（经 @heybe/fastclaw-adapter /v1）。
 *
 * 环境变量（必填）：
 *   HEYBE_FASTCLAW_BASE_URL  例 http://127.0.0.1:18953
 *   HEYBE_FASTCLAW_TOKEN     FastClaw API key（绝不打印）
 *
 * 可选：
 *   HEYBE_FASTCLAW_AGENT_ID  指定 Agent；省略则取 listAgents 的第一个
 *   HEYBE_POC_PROBE_MODEL    请求里的 model 回显探针（默认 heybe-probe-model-echo）
 *   HEYBE_POC_PROMPT         用户消息（默认一句短中文）
 *
 * DeepSeek 密钥不经本脚本：须已在 FastClaw Agent 配置里（agents init / 控制台）。
 *
 * 运行：
 *   pnpm dlx tsx scripts/poc/deepseek-min-chat.ts
 *
 * 本机没有可用的 FastClaw 时清晰失败（exit 1），不假装成功。
 */

import {
  FastClawClient,
  FastClawConfigError,
  FastClawError,
  fastClawClientFromEnv,
} from "../../packages/fastclaw-adapter/src/index.ts";

const PROBE_MODEL = process.env.HEYBE_POC_PROBE_MODEL?.trim() || "heybe-probe-model-echo";
const PROMPT =
  process.env.HEYBE_POC_PROMPT?.trim() || "用一句话介绍你自己，不要超过 40 个字。";

interface Report {
  ok: boolean;
  stream_ok: boolean;
  first_token_ms: number | null;
  total_ms: number | null;
  error_code: string | null;
  error_kind: string | null;
  error_status: number | null;
  request_model: string;
  response_model: string | null;
  model_echo_matches_request: boolean | null;
  agent_id: string | null;
  note: string;
}

function printReport(report: Report): void {
  // 结构化 JSON，便于粘贴回传；不含 token / 密钥 / 原文回复内容
  console.log(JSON.stringify(report, null, 2));
}

function failClear(message: string, extra: Partial<Report> = {}): never {
  printReport({
    ok: false,
    stream_ok: false,
    first_token_ms: null,
    total_ms: null,
    error_code: extra.error_code ?? "poc_preflight",
    error_kind: extra.error_kind ?? "preflight",
    error_status: extra.error_status ?? null,
    request_model: PROBE_MODEL,
    response_model: null,
    model_echo_matches_request: null,
    agent_id: extra.agent_id ?? null,
    note: message,
  });
  process.exit(1);
}

function redactNote(text: string): string {
  // 防御性脱敏：去掉看起来像 bearer / sk- 的片段
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bfc_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

async function resolveAgentId(client: FastClawClient): Promise<string> {
  const forced = process.env.HEYBE_FASTCLAW_AGENT_ID?.trim();
  if (forced) return forced;
  const list = await client.listAgents({ limit: 20 });
  const first = list.agents[0];
  if (!first?.id) {
    failClear(
      "FastClaw 已连通，但 GET /v1/agents 没有可用 Agent。请先用 fastclaw agents init 配置 DeepSeek（或控制台创建 Agent）。",
    );
  }
  return first.id;
}

async function main(): Promise<void> {
  let client: FastClawClient;
  try {
    client = fastClawClientFromEnv(process.env, {
      // PoC 允许较长首包；0=禁用客户端超时（仍受本机网络影响）
      timeoutMs: 120_000,
      retry: { maxAttempts: 1 },
    });
  } catch (err) {
    if (err instanceof FastClawConfigError) {
      failClear(
        `缺少或无效的环境变量：${err.missing.join(", ")}。` +
          "请设置 HEYBE_FASTCLAW_BASE_URL 与 HEYBE_FASTCLAW_TOKEN（见 docs/poc-deepseek-min.md）。DeepSeek 密钥不经本脚本。",
      );
    }
    throw err;
  }

  // 预检：没有 FastClaw 进程时清晰失败
  try {
    await client.health({ timeoutMs: 5_000 });
  } catch (err) {
    if (err instanceof FastClawError) {
      failClear(
        redactNote(
          `无法连接 FastClaw（${err.kind}${err.status ? ` HTTP ${err.status}` : ""}` +
            `${err.code ? ` code=${err.code}` : ""}）。` +
            "请确认本机已启动固定版本 v1.4.0（默认 http://127.0.0.1:18953），" +
            "且 HEYBE_FASTCLAW_* 指向该进程。本脚本不会假装成功。详情见 docs/poc-deepseek-min.md。",
        ),
        {
          error_code: err.code ?? err.kind,
          error_kind: err.kind,
          error_status: err.status ?? null,
        },
      );
    }
    failClear(redactNote(err instanceof Error ? err.message : String(err)));
  }

  const agentId = await resolveAgentId(client);
  const session = client.createSession({ agentId });

  const t0 = Date.now();
  let firstTokenMs: number | null = null;
  let streamOk = false;
  let streamErrorCode: string | null = null;
  let streamErrorKind: string | null = null;
  let streamErrorStatus: number | null = null;

  try {
    for await (const event of client.streamMessage(session, {
      messages: [{ role: "user", content: PROMPT }],
      model: PROBE_MODEL,
      timeoutMs: 120_000,
    })) {
      if (event.type === "delta" && event.content && firstTokenMs === null) {
        firstTokenMs = Date.now() - t0;
      }
      if (event.type === "done") {
        streamOk = true;
      }
    }
    // 若流正常结束但没有显式 done 事件，只要没有抛错也算流式成功
    if (!streamOk && firstTokenMs !== null) streamOk = true;
    if (!streamOk) {
      // 空流：不假装成功
      streamErrorCode = "empty_stream";
      streamErrorKind = "5xx";
    }
  } catch (err) {
    streamOk = false;
    if (err instanceof FastClawError) {
      streamErrorCode = err.code ?? err.kind;
      streamErrorKind = err.kind;
      streamErrorStatus = err.status ?? null;
    } else {
      streamErrorCode = "unknown";
      streamErrorKind = "network";
    }
  }

  const streamTotalMs = Date.now() - t0;

  // model 回显：streamMessage 解析后的 V1StreamEvent 不含 model 字段，
  // 另用一次非流式 sendMessage（仍走适配层 /v1）做 T0.2.1 对比。
  let responseModel: string | null = null;
  let modelMatch: boolean | null = null;
  let modelNote = "";
  try {
    const completion = await client.sendMessage(session, {
      messages: [{ role: "user", content: "ping" }],
      model: PROBE_MODEL,
      timeoutMs: 120_000,
    });
    responseModel = typeof completion.model === "string" ? completion.model : null;
    modelMatch = responseModel === PROBE_MODEL;
    modelNote =
      "model 回显来自非流式 sendMessage（stream 事件不含 model）；" +
      "源码预期：回显等于请求值，且不覆盖 Agent 配置。运行时是否如此仍以本结果为准。";
  } catch (err) {
    modelNote =
      "流式已跑完，但用于 T0.2.1 的非流式 model 回显请求失败：" +
      redactNote(err instanceof FastClawError ? err.message : err instanceof Error ? err.message : String(err));
  }

  const ok = streamOk && streamErrorCode === null;
  printReport({
    ok,
    stream_ok: streamOk,
    first_token_ms: firstTokenMs,
    total_ms: streamTotalMs,
    error_code: streamErrorCode,
    error_kind: streamErrorKind,
    error_status: streamErrorStatus,
    request_model: PROBE_MODEL,
    response_model: responseModel,
    model_echo_matches_request: modelMatch,
    agent_id: agentId,
    note: redactNote(
      ok
        ? `流式成功。${modelNote}`
        : `流式未成功（code=${streamErrorCode ?? "n/a"}）。${modelNote}`,
    ),
  });
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  failClear(redactNote(err instanceof Error ? err.message : String(err)));
});
