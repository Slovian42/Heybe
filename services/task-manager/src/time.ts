export function isoNow(date = new Date()): string {
  return date.toISOString();
}

export function addMs(iso: string, ms: number): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) throw new Error(`invalid timestamp: ${iso}`);
  return new Date(parsed + ms).toISOString();
}
