/** Replace known secrets of at least 8 characters. Never log the token. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8 || !out.includes(secret)) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}
