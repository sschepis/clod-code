export const MEMORY_SECTION =
  '## Hierarchical Memory\n' +
  'You have durable memory across three scopes. Commands live under `memory/*`:\n' +
  '- `memory/recall query="..." scope?="all|conversation|project|global"` — search by resonance.\n' +
  '- `memory/add title="..." body="..." tags?="csv"` — record a durable fact in THIS conversation.\n' +
  '- `memory/promote id="..." to="project|global"` — elevate a noteworthy entry upward.\n' +
  '- `memory/list scope?="conversation|project|global"` — recent entries in a scope.\n' +
  '- `memory/forget id="..."` — remove an entry.\n' +
  'Scopes: conversation (this session; given to any agent spawned from here), project (this workspace, persists across sessions), global (across all workspaces). Promote sparingly — only facts that stay true for the whole project or for the user in general. Tool-call outputs are auto-captured at low strength; promote the ones worth keeping.';
