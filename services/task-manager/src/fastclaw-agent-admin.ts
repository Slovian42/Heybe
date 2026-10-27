import type { V1Agent, V1AgentDeleted } from "@heybe/shared-types";
import {
  FastClawClient,
  FastClawConfigError,
  fastClawAdminClientFromEnv,
  type CreateAgentInput,
} from "@heybe/fastclaw-adapter";

/**
 * The only place Heybe creates or deletes FastClaw Agents.
 *
 * Holds the owner key (HEYBE_FASTCLAW_ADMIN_TOKEN) in an `admin` client that
 * cannot chat. Conversations use the separate chat key (HEYBE_FASTCLAW_CHAT_TOKEN)
 * through FastClawNodeExecutor, whose client refuses /v1/agents mutations.
 *
 * FastClaw v1.4.0 does not enforce this split for `type=user` keys: any such key
 * may POST/DELETE /v1/agents. The split limits which Heybe component holds which
 * key; see docs/t044-agent-boundary.md §2.
 */
export class FastClawAgentAdmin {
  constructor(private readonly client: FastClawClient) {
    if (client.role !== "admin") throw new FastClawConfigError(["agent admin requires an admin-role client"]);
  }

  createAgent(input: CreateAgentInput): Promise<V1Agent> {
    return this.client.createAgent(input);
  }

  deleteAgent(id: string): Promise<V1AgentDeleted> {
    return this.client.deleteAgent(id);
  }

  getAgent(id: string): Promise<V1Agent> {
    return this.client.getAgent(id);
  }
}

/** Build from HEYBE_FASTCLAW_BASE_URL + HEYBE_FASTCLAW_ADMIN_TOKEN. Values are never logged. */
export function fastClawAgentAdminFromEnv(env: Record<string, string | undefined> = process.env): FastClawAgentAdmin {
  return new FastClawAgentAdmin(fastClawAdminClientFromEnv(env, { retry: { maxAttempts: 1 } }));
}
