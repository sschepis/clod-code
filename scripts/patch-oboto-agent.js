#!/usr/bin/env node
/**
 * Patches @sschepis/oboto-agent to add `name` field to tool result messages
 * in the streaming execution path. Without this, Gemini receives
 * functionResponse.name = "unknown" and returns empty responses.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname, '..', 'node_modules', '@sschepis', 'oboto-agent', 'dist', 'index.js'
);

if (!fs.existsSync(target)) {
  console.log('[patch] @sschepis/oboto-agent not found, skipping');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
const needle = 'role: "tool",\n                tool_call_id: tc.id,\n                content:';

if (src.includes('name: tc.function.name,')) {
  console.log('[patch] @sschepis/oboto-agent already patched');
  process.exit(0);
}

const patched = src.replace(
  /role: "tool",\n(\s+)tool_call_id: tc\.id,\n(\s+)content:/g,
  'role: "tool",\n$1tool_call_id: tc.id,\n$2name: tc.function.name,\n$2content:'
);

if (patched === src) {
  console.log('[patch] No matching patterns found — oboto-agent may have changed');
  process.exit(0);
}

fs.writeFileSync(target, patched);
console.log('[patch] @sschepis/oboto-agent patched: added name to tool result messages');
