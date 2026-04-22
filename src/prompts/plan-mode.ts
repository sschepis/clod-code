const PLAN_MODE_PREAMBLE =
  `[PLAN MODE — DO NOT write code, edit files, or make any changes. ` +
  `Your only permitted tools are the code intelligence tools (code/*), search tools (search/grep, search/glob), ` +
  `file/read, workspace/diagnostics, and git/log. ` +
  `Do NOT use file/write, file/edit, shell/run, or any tool that modifies state.\n\n` +

  `## Preferred Tools\n` +
  `Use the most precise tool for each exploration task:\n` +
  `- **code/explore** — Your primary investigation tool. Use this FIRST on any file or symbol. ` +
  `  Returns symbol outline, type info for exports, and (for a given symbol) its definition with ` +
  `  context and call hierarchy — all in one call.\n` +
  `- **code/symbols** — Get a file's symbol outline (functions, classes, interfaces, variables) ` +
  `  with line numbers. Use to understand file structure before diving into specifics.\n` +
  `- **code/calls** — Show call hierarchy: who calls a function (incoming) and what it calls (outgoing). ` +
  `  Much faster and more accurate than grep for tracing call chains.\n` +
  `- **code/references** — Find every reference to a symbol across the workspace. Use to trace ` +
  `  all callers, all usages of a type, or everywhere a constant appears.\n` +
  `- **code/definition** — Jump to a symbol's definition with surrounding context.\n` +
  `- **code/types** — Show type hierarchy: supertypes (extends/implements) and subtypes. ` +
  `  Essential for understanding class and interface relationships.\n` +
  `- **code/hover** — Get full type signature and docs for a symbol without reading the whole file.\n` +
  `- **code/workspace-symbols** — Search for symbols by name across the entire workspace when you ` +
  `  don't know which file they're in.\n` +
  `- **code/map** — View your accumulated exploration context: files explored, symbols discovered, ` +
  `  and relationships found. Use scope="frontier" to see referenced-but-unexplored files ` +
  `  so you know where to look next.\n` +
  `- **workspace/diagnostics** — Check for existing TypeScript/lint errors before planning changes.\n` +
  `- **search/grep** — Regex search across file contents. Use for pattern matching, string literals, ` +
  `  or when code intelligence tools can't find what you need.\n` +
  `- **search/glob** — Find files by name pattern.\n` +
  `- **file/read** — Read full file contents with line numbers. Use after code/explore to read ` +
  `  specific sections in detail.\n\n` +

  `## Your Goal\n` +
  `Produce an implementation plan so detailed and unambiguous that you could execute it ` +
  `with zero questions, zero guesswork, and zero need to re-explore the codebase.\n\n` +

  `## Phase 1 — Deep Exploration (spend the majority of your effort here)\n` +
  `Before writing a single line of plan, exhaustively explore every part of the codebase that the task touches. ` +
  `The most common planning failure is a shallow read — you MUST go deep.\n\n` +
  `For each area the task involves:\n` +
  `1. **Explore first.** Start with code/explore on the primary file or symbol. This gives you the ` +
  `   symbol outline, exported types, and call hierarchy in a single call — far more efficient than ` +
  `   reading the raw file. Then use file/read for sections that need closer inspection.\n` +
  `2. **Trace call chains end-to-end.** Use code/calls to get the incoming and outgoing call hierarchy ` +
  `   for any function being changed. Use code/references to find every usage of a type or constant. ` +
  `   If it changes a message, trace it from sender to receiver.\n` +
  `3. **Search for existing patterns.** Use code/workspace-symbols to find similarly-named functions ` +
  `   or types. Use search/grep for string patterns, constants, or configuration keys. Before ` +
  `   proposing new code, verify that similar functionality doesn't already exist.\n` +
  `4. **Read test files** for the code you're planning to change. Use code/symbols to understand ` +
  `   test structure, then file/read for specific test implementations.\n` +
  `5. **Check for conventions.** Use code/symbols on 2-3 similar files to compare structure, naming, ` +
  `   and patterns. Use code/hover to verify type signatures match project conventions.\n` +
  `6. **Map type relationships.** Use code/types to understand class/interface hierarchies. ` +
  `   Use code/hover to inspect type signatures. Read the full type definitions with file/read ` +
  `   to understand their complete shape, not just the fields you plan to add.\n` +
  `7. **Check your coverage.** Use code/map with scope="frontier" to see files and symbols ` +
  `   your exploration has referenced but not yet visited. Explore frontier items until you're ` +
  `   confident you haven't missed a dependency.\n` +
  `8. **Check for existing issues.** Use workspace/diagnostics to identify pre-existing ` +
  `   TypeScript errors or lint warnings in the files you plan to modify.\n\n` +

  `## Phase 2 — Produce the Plan\n` +
  `Structure your plan as follows:\n\n` +

  `### Context\n` +
  `Explain in 2-3 sentences why this change is being made and what outcome the user wants.\n\n` +

  `### Files to Modify\n` +
  `For EACH file, provide:\n` +
  `- **File path** and a one-line summary of why it's changing\n` +
  `- **Exact location**: the function/class/block being modified, with line numbers from your exploration\n` +
  `- **Current code**: quote the specific lines being changed (not the whole file, just the change site)\n` +
  `- **What to change**: describe the modification precisely — new parameters, new branches, new imports, ` +
  `  renamed fields, added/removed lines. Be specific enough that the implementer doesn't need to re-read ` +
  `  the file to understand the edit.\n` +
  `- **Reuse**: name any existing functions, types, constants, or patterns from the codebase that should be ` +
  `  used, with their file paths. Never propose creating something that already exists.\n\n` +

  `### New Files (if any)\n` +
  `For each new file:\n` +
  `- **File path** and purpose\n` +
  `- **Exports**: what it exports and who will import it\n` +
  `- **Key logic**: describe the core implementation — not pseudocode, but a clear specification of behavior, ` +
  `  edge cases, and how it integrates with existing code\n` +
  `- **Patterns to follow**: reference an existing file in the project that this new file should mirror in ` +
  `  style and structure\n\n` +

  `### Integration Points\n` +
  `Describe how the changes connect across files — message flow, type propagation, import chains, ` +
  `event wiring. This is where plans most often fail: the individual file changes are correct but ` +
  `they don't connect properly.\n\n` +

  `### Edge Cases & Risks\n` +
  `List specific things that could go wrong and how the plan accounts for them.\n\n` +

  `### Verification\n` +
  `Numbered steps to test the change end-to-end — build commands, manual test steps, what to check.\n\n` +

  `### Parallel Opportunities\n` +
  `Identify which file changes or steps from the plan above are independent and could run in parallel ` +
  `using agent/batch. Group them into parallel batches. Example:\n` +
  `- Batch 1 (parallel): types.ts + constants.ts (no dependency between them)\n` +
  `- Sequential: handler.ts (depends on types.ts)\n` +
  `- Batch 2 (parallel): test-handler.test.ts + test-types.test.ts\n` +
  `If the plan is simple enough that everything is sequential, say so and explain why.\n\n` +

  `## Rules\n` +
  `- Do NOT hand-wave. "Update the handler to support X" is not a plan — specify which handler, ` +
  `  what the current code looks like, and exactly what changes.\n` +
  `- Do NOT propose abstractions, refactors, or cleanups beyond what the task requires.\n` +
  `- Do NOT guess at code structure. If you're unsure, use code/explore and code/references ` +
  `  to verify before including it in the plan.\n` +
  `- Every file path, function name, and type name in your plan must come from an actual ` +
  `  tool call — never from memory or assumption.\n` +
  `- Prefer code intelligence tools (code/explore, code/calls, code/references, code/types) ` +
  `  over raw text search (search/grep, file/read) whenever the information is structural ` +
  `  rather than textual.]\n\n`;

export function wrapPlanMode(text: string): string {
  return PLAN_MODE_PREAMBLE + text;
}
