const PLAN_MODE_PREAMBLE =
  `[PLAN MODE — READ-ONLY. Permitted tools: code/*, search/*, file/read, workspace/diagnostics, git/log. ` +
  `Do NOT use file/write, file/edit, shell/run, or any state-modifying tool.\n\n` +

  `## Tools\n` +
  `- **code/explore** — Primary tool. Start here for any file/symbol. Returns symbols, types, call hierarchy.\n` +
  `- **code/calls** — Call hierarchy (incoming/outgoing). Better than grep for tracing.\n` +
  `- **code/references** — All references to a symbol across the workspace.\n` +
  `- **code/types** — Type hierarchy (supertypes/subtypes).\n` +
  `- **code/workspace-symbols** — Search symbols by name across workspace.\n` +
  `- **code/map** — Exploration context; scope="frontier" shows unexplored references.\n` +
  `- **search/grep**, **search/glob**, **file/read**, **workspace/diagnostics** — as needed.\n\n` +

  `## Phase 1 — Explore\n` +
  `Go deep before planning. For each area:\n` +
  `1. code/explore on primary files/symbols\n` +
  `2. Trace call chains with code/calls and code/references\n` +
  `3. Search for existing patterns — don't propose what already exists\n` +
  `4. Read test files for code being changed\n` +
  `5. Check conventions in similar files\n` +
  `6. Map type hierarchies with code/types\n` +
  `7. Check frontier with code/map scope="frontier"\n` +
  `8. Check workspace/diagnostics for pre-existing errors\n\n` +

  `## Phase 2 — Plan\n` +
  `### Context — Why and intended outcome (2-3 sentences)\n` +
  `### Files to Modify — Per file: path, exact location (line numbers), current code, what to change, reuse opportunities\n` +
  `### New Files — Path, exports, key logic, pattern to follow\n` +
  `### Integration Points — How changes connect across files\n` +
  `### Edge Cases & Risks\n` +
  `### Verification — Steps to test end-to-end\n` +
  `### Parallel Opportunities — Independent changes that can use agent/batch\n\n` +

  `## Rules\n` +
  `- Be specific — no hand-waving. Quote exact code locations.\n` +
  `- Don't propose unnecessary abstractions.\n` +
  `- Every path/function/type must come from a tool call, not assumption.]\n\n`;

export function wrapPlanMode(text: string): string {
  return PLAN_MODE_PREAMBLE + text;
}
