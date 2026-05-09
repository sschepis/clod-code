import * as vscode from 'vscode';
import type { ExplorerContributor, ContributedNode } from './explorer-contributor';

export class OpenClawContributor implements ExplorerContributor {
  readonly id = 'openclaw';
  readonly label = 'OpenClaw Servers';
  readonly iconId = 'server';
  readonly initialState = 'collapsed';

  constructor() {
    // Ideally we would listen to events from the OpenClaw RPC manager here
    // and fire an event to the provider to refresh.
  }

  async getChildren(node: ContributedNode | undefined): Promise<ContributedNode[]> {
    if (!node) {
      // Top level children (The servers)
      return [
        {
          label: 'Local OpenClaw (Port 3000)',
          collapsibleState: 'collapsed',
          iconId: 'vm-active',
          contributorNodeId: 'local-3000',
          contextValue: 'openclaw-server'
        }
      ];
    }

    if (node.contributorNodeId === 'local-3000') {
      return [
        {
          label: 'Status: Connected',
          collapsibleState: 'none',
          iconId: 'pass',
        },
        {
          label: 'Active Agents: 2',
          collapsibleState: 'none',
          iconId: 'hub',
        }
      ];
    }

    return [];
  }
}
