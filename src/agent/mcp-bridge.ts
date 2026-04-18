import type { AgentDynamicTools, DynamicToolProvider, DynamicToolEntry } from '@sschepis/oboto-agent';
import { dynamicImport } from '../shared/dynamic-import';

/**
 * Placeholder MCP bridge. For now, creates an empty dynamic tools branch.
 * Full MCP JSON-RPC protocol implementation is deferred to Phase 5.
 *
 * When implemented, this will:
 * 1. Spawn MCP servers (stdio transport) from settings
 * 2. Send tools/list JSON-RPC to discover available tools
 * 3. Register each as a DynamicToolEntry
 * 4. Execute tool calls via tools/call JSON-RPC
 */
export async function createMcpToolsBranch(mcpConfig?: Record<string, unknown>): Promise<AgentDynamicTools | null> {
  if (!mcpConfig || Object.keys(mcpConfig).length === 0) return null;

  // Dynamic import because oboto-agent is ESM-only
  const { AgentDynamicTools: AgentDynamicToolsCtor } = await dynamicImport<typeof import('@sschepis/oboto-agent')>('@sschepis/oboto-agent');

  const provider: DynamicToolProvider = {
    discover(): DynamicToolEntry[] {
      // Phase 5: Implement MCP server discovery here
      return [];
    },
  };

  return new AgentDynamicToolsCtor({
    name: 'mcp',
    description: 'Tools discovered from MCP servers',
    provider,
    ttlMs: 60_000,
  });
}
