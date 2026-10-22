// Thin typed client for FastClaw. ONLY the /v1/* app-integration API is allowed.
// /api/* is FastClaw's internal console API and may change; do not call it here.
// Pinned upstream: see docs/phase0-dev-env.md (FastClaw v1.4.0).
// NOTE: the `model` field in chat requests does NOT override an Agent's model config.
// Switch models via a verified Agent config or a fallback Agent instead.

export interface FastClawClientOptions {
  baseUrl: string;
  /** Read from env/keychain by the caller; never log it. */
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface V1Agent { id: string; name: string; metadata?: Record<string, string>; [k: string]: unknown }
export interface V1ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string }
export interface V1ChatRequest { agent_id?: string; model?: string; messages: V1ChatMessage[]; stream?: boolean; [k: string]: unknown }

export class FastClawError extends Error {
  constructor(public status: number, public path: string, message: string) { super(message); }
}

const V1_PREFIX = "/v1/";

export function assertV1Path(path: string): void {
  if (!path.startsWith(V1_PREFIX)) throw new Error(`Only FastClaw /v1/* is allowed, got: ${path}`);
}

export class FastClawClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: FastClawClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    assertV1Path(path);
    const res = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new FastClawError(res.status, path, `FastClaw ${method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  listAgents(): Promise<{ data: V1Agent[] }> { return this.request("GET", "/v1/agents"); }
  getAgent(id: string): Promise<V1Agent> { return this.request("GET", `/v1/agents/${encodeURIComponent(id)}`); }
  /** Non-streaming chat. Streaming + status/cancel are TODO pending interface verification (docs/interface-verification.md). */
  chat(req: V1ChatRequest): Promise<unknown> { return this.request("POST", "/v1/chat/completions", { ...req, stream: false }); }
}
