export function getErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return sanitize(err);

  if (err instanceof Error) {
    const any = err as any;
    if (any.status && any.body) {
      try {
        const body = typeof any.body === 'string' ? any.body : JSON.stringify(any.body);
        return sanitize(`HTTP ${any.status}: ${body}`);
      } catch { /* fall through */ }
    }
    if (any.response?.data) {
      try {
        const data = typeof any.response.data === 'string'
          ? any.response.data
          : JSON.stringify(any.response.data);
        return sanitize(data);
      } catch { /* fall through */ }
    }
    if (err.message) return sanitize(err.message);
    if (any.cause) return getErrorMessage(any.cause);
    if (any.code) return sanitize(`${err.name}: ${any.code}`);
    try {
      const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err));
      if (serialized && serialized !== '{}') return sanitize(serialized);
    } catch { /* fall through */ }
    return err.name || 'Unknown error';
  }

  if (typeof err === 'object') {
    const any = err as any;
    if (any.message) return sanitize(String(any.message));
    if (any.error?.message) return sanitize(String(any.error.message));
    if (any.error) return sanitize(typeof any.error === 'string' ? any.error : JSON.stringify(any.error));
    if (any.statusText) return sanitize(`HTTP ${any.status ?? '?'}: ${any.statusText}`);
    try { return sanitize(JSON.stringify(err)); } catch { return sanitize(String(err)); }
  }

  return sanitize(String(err));
}

function sanitize(text: string): string {
  let clean = text;
  if (/<[a-zA-Z][^>]*>/.test(clean)) {
    clean = clean.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  if (clean.length > 200) clean = clean.slice(0, 197) + '...';
  if (!clean) return 'Unknown error';
  return clean;
}
