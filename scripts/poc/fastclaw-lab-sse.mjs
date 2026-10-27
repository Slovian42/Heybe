// Summarise a FastClaw /v1 SSE capture for scripts/poc/fastclaw-lab.sh.
// Usage: node fastclaw-lab-sse.mjs <file.sse>  → one JSON line on stdout.
// Never prints request headers or tokens (the capture contains only the response body).
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2], "utf8");
const out = { done: false, finish: null, model: null, text: "", tools: [], files: [], error: null, chunks: 0 };
for (const line of raw.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  const data = line.slice(6).trim();
  if (data === "[DONE]") {
    out.done = true;
    continue;
  }
  let j;
  try {
    j = JSON.parse(data);
  } catch {
    continue;
  }
  out.chunks += 1;
  if (j.model) out.model = j.model;
  const c = j.choices?.[0];
  if (c?.delta?.content) out.text += c.delta.content;
  if (c?.finish_reason) out.finish = c.finish_reason;
  if (j.tool) out.tools.push({ id: j.tool.id, name: j.tool.name, status: j.tool.status, keys: Object.keys(j.tool).sort().join(",") });
  if (Array.isArray(j.files)) out.files = j.files.map((f) => ({ name: f.name, path: f.path, size: f.size, url: f.url }));
  if (j.error) out.error = { code: j.error.code ?? null, type: j.error.type ?? null };
}
console.log(JSON.stringify(out));
