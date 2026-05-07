export type ErrorCategory = 'cdn-failure' | 'syntax-error' | 'reference-error' | 'network-error' | 'unknown';

export function classifyError(message: string, stack?: string): ErrorCategory {
  const m = (message + ' ' + (stack || '')).toLowerCase();
  if (m.includes('failed to load') || m.includes('err_name_not_resolved') || m.includes('net::err'))
    return 'cdn-failure';
  if (m.includes('syntaxerror'))
    return 'syntax-error';
  if (m.includes('referenceerror') || (m.includes('typeerror') && m.includes('undefined')))
    return 'reference-error';
  if (m.includes('fetch failed') || m.includes('networkerror') || m.includes('failed to fetch'))
    return 'network-error';
  return 'unknown';
}

const CATEGORY_HINTS: Record<ErrorCategory, string> = {
  'cdn-failure': 'The error is a CDN/script loading failure. Try an alternative CDN (jsdelivr, unpkg, or cdnjs). Do NOT rewrite the surface logic.',
  'syntax-error': 'The error is a JavaScript syntax error. Look for typos, missing brackets, or template literal issues near the reported line.',
  'reference-error': 'The error is a missing variable or property access on undefined. Check for misspelled identifiers or code that runs before its dependencies are loaded.',
  'network-error': 'The error is a network/fetch failure. Check that the routes server URL is correct and the endpoint exists. Do NOT rewrite the surface — fix the URL or add error handling for the fetch call.',
  'unknown': '',
};

export function surfaceAutoFixPrompt(
  surfaceName: string,
  errorDetail: string,
  source: string,
  consoleLogs?: string[],
  attemptNumber?: number,
  errorCategory?: ErrorCategory,
): string {
  let prompt =
    `The surface "${surfaceName}" threw a runtime JavaScript error in its webview panel.\n\n` +
    `${errorDetail}\n\n`;

  if (errorCategory && CATEGORY_HINTS[errorCategory]) {
    prompt += `Error category: ${errorCategory}\n${CATEGORY_HINTS[errorCategory]}\n\n`;
  }

  if (attemptNumber && attemptNumber > 1) {
    prompt +=
      `IMPORTANT: This is attempt #${attemptNumber} to fix this error. ` +
      `Previous fixes did not resolve it. Try a different approach.\n\n`;
  }

  if (consoleLogs && consoleLogs.length > 0) {
    prompt += `Recent console.error output (may contain clues):\n`;
    prompt += consoleLogs.map(log => `  - ${log}`).join('\n');
    prompt += '\n\n';
  }

  prompt +=
    `Here is the full source of the surface:\n\n` +
    `\`\`\`html\n${source}\n\`\`\`\n\n` +
    `Fix the error by calling the surface/update tool with the corrected HTML. ` +
    `Only fix the bug — do not change the surface's behavior or appearance otherwise.`;

  return prompt;
}

export function surfaceCrashedNotice(surfaceName: string, errorMessage: string): string {
  return `Surface "${surfaceName}" crashed: ${errorMessage} — attempting auto-fix…`;
}
