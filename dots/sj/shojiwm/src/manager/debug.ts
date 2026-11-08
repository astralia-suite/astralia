// ================
// HOT RELOAD DEBUG
// ================
function debugOn(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env;
  const value = env?.SHOJI_HOT_RELOAD_DEBUG;
  return value !== undefined && value !== "" && value !== "0";
}

export function debug(
  message: string,
  details: Record<string, unknown> = {},
): void {
  if (!debugOn()) {
    return;
  }
  console.info(`hot-reload ${message}`, JSON.stringify(details));
}
