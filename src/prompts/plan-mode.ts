const PLAN_MODE_PREAMBLE =
  `[PLAN MODE — READ ONLY. DO NOT write code, edit files, or execute commands. ` +
  `Your only permitted tools are the read-only native tools (code_explore, file_read, search_grep) ` +
  `and safe extended commands via terminal_interface (like search/glob, workspace/diagnostics, or git/log). ` +
  `Do NOT use file_edit, shell_run, or any command that modifies state.\\n\\n` +

  `## Preferred Exploration Path\\n` +
  `- Start with **code_explore** as your primary investigation tool. It yields symbols, types, definitions, and call hierarchies simultaneously.\\n` +
  `- Use **file_read** to inspect specific lines or implementations.\\n` +
  `- Use **search_grep** (or extended search/glob) to find patterns or trace strings across the workspace.\\n` +
  `- Fall back to **terminal_interface(command="code/*")** commands (like code/workspace-symbols or code/references) if the native code_explore isn't sufficient.\\n\\n` +

  `## Phase 1 — Deep Exploration\\n` +
  `Before writing a plan, explore the codebase thoroughly to understand the context.\\n\\n` +
  `1. **Explore first.** Start with \`code_explore\` on primary files/symbols.\\n` +
  `2. **Trace connections.** Use the call hierarchies returned by \`code_explore\` to understand data flow.\\n` +
  `3. **Search for patterns.** Use \`search_grep\` to find related strings or configs.\\n` +
  `4. **Read related tests.** Use \`file_read\` to see how similar code is tested.\\n` +
  `5. **Check diagnostics.** Use \`terminal_interface(command="workspace/diagnostics")\` to spot pre-existing errors.\\n\\n` +

  `## Phase 2 — Produce the Plan\\n` +
  `Structure your plan logically and clearly:\\n\\n` +

  `### Context\\n` +
  `Briefly explain why this change is being made and the intended outcome.\\n\\n` +

  `### Files to Modify\\n` +
  `For EACH file, provide:\\n` +
  `- **File path** and a brief summary of the change\\n` +
  `- **Location**: which function or block is being modified\\n` +
  `- **Modification**: what needs to be changed (be specific enough that an engineer can follow it)\\n` +
  `- **Reuse**: note any existing patterns or functions to leverage\\n\\n` +

  `### New Files (if any)\\n` +
  `For each new file:\\n` +
  `- **File path** and purpose\\n` +
  `- **Key logic**: describe core behavior and integration points\\n\\n` +

  `### Integration Points\\n` +
  `Describe how changes connect across files.\\n\\n` +

  `### Edge Cases & Risks\\n` +
  `List specific risks and how the plan mitigates them.\\n\\n` +

  `### Verification\\n` +
  `Steps to verify the change works end-to-end.\\n\\n` +

  `### Parallel Opportunities\\n` +
  `Identify independent changes that could be executed concurrently using \`agent/batch\`.\\n\\n` +

  `## Guidelines\\n` +
  `- Avoid vague statements like "Update the logic." Be concrete about what is changing.\\n` +
  `- Stick to the requirements—don't propose unrelated refactoring.\\n` +
  `- Ground your plan in reality: ensure paths and symbol names match what you found in exploration.\\n` +
  `]\n\n`;

export function wrapPlanMode(text: string): string {
  return PLAN_MODE_PREAMBLE + text;
}
