export function surfaceAutoFixPrompt(
  surfaceName: string,
  errorDetail: string,
  source: string,
  consoleLogs?: string[],
  attemptNumber?: number,
): string {
  let prompt =
    `The surface "${surfaceName}" threw a runtime JavaScript error in its webview panel.\n\n` +
    `${errorDetail}\n\n`;

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
