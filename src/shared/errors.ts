/**
 * Extract a human-readable message from any thrown value.
 *
 * Some SDKs throw plain objects or Error subclasses where `.message` is
 * undefined, which produces "undefined" in user-facing error displays.
 * This walker tries a series of properties and falls back to JSON
 * serialization so the user always sees something meaningful.
 */
export function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return err;

  if (err instanceof Error) {
    if (err.message) return err.message;
    // Some Error subclasses stash info on other properties
    const any = err as any;
    if (any.response?.data) {
      try {
        return typeof any.response.data === 'string'
          ? any.response.data
          : JSON.stringify(any.response.data);
      } catch { /* fall through */ }
    }
    if (any.cause) return getErrorMessage(any.cause);
    if (any.code) return `${err.name}: ${any.code}`;
    return err.name || 'Unknown error';
  }

  if (typeof err === 'object') {
    const any = err as any;
    if (any.message) return String(any.message);
    if (any.error?.message) return String(any.error.message);
    if (any.error) return typeof any.error === 'string' ? any.error : JSON.stringify(any.error);
    if (any.statusText) return `HTTP ${any.status ?? '?'}: ${any.statusText}`;
    try { return JSON.stringify(err); } catch { return String(err); }
  }

  return String(err);
}
