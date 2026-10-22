import { FastClawError } from "./errors.js";

const V1_PREFIX = "/v1/";

function decodePath(pathname: string): string {
  let current = pathname;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      throw new Error("Only FastClaw /v1/* is allowed");
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/** Reject anything that is not a FastClaw app-integration path. */
export function assertV1Path(path: string): void {
  if (path.includes("\\") || /[\r\n\0]/.test(path)) {
    throw new Error("Only FastClaw /v1/* is allowed");
  }
  const query = path.indexOf("?");
  const pathname = query === -1 ? path : path.slice(0, query);
  const decoded = decodePath(pathname);
  // Prefix plus traversal rejection. Console routes live outside /v1 and never pass this check.
  if (!decoded.startsWith(V1_PREFIX) || decoded.includes("..")) {
    throw new Error("Only FastClaw /v1/* is allowed");
  }
}

export function invalidRequest(method: string, path: string, message: string): FastClawError {
  return new FastClawError({
    kind: "4xx",
    status: 400,
    method,
    path,
    code: "invalid_request",
    message,
  });
}

export function assertSegment(value: string, label: string, method: string, path: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\s/?#\\]/.test(trimmed) || trimmed.includes("..")) {
    throw invalidRequest(method, path, `Invalid ${label}`);
  }
  return trimmed;
}

/** Relative workspace path for GET .../files/{path}. Rejects traversal. */
export function sessionFilePath(
  agentId: string,
  sessionKey: string,
  filePath: string,
  projectId?: string,
): string {
  const method = "GET";
  const fallback = "/v1/agents";
  const id = assertSegment(agentId, "agent id", method, fallback);
  if (!sessionKey || /[\r\n]/.test(sessionKey) || sessionKey.includes("..")) {
    throw invalidRequest(method, fallback, "Invalid session key");
  }
  if (
    !filePath ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    /[\r\n]/.test(filePath) ||
    filePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw invalidRequest(method, fallback, "Invalid file path");
  }
  const encodedPath = filePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  let path =
    `/v1/agents/${encodeURIComponent(id)}` +
    `/sessions/${encodeURIComponent(sessionKey)}` +
    `/files/${encodedPath}`;
  if (projectId !== undefined && projectId !== "") {
    if (/[\r\n]/.test(projectId)) throw invalidRequest(method, path, "Invalid project id");
    path += `?project_id=${encodeURIComponent(projectId)}`;
  }
  assertV1Path(path);
  return path;
}

export function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const starred = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (starred?.[1]) {
    try {
      return decodeURIComponent(starred[1]);
    } catch {
      return starred[1];
    }
  }
  const quoted = /filename="([^"]*)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}
