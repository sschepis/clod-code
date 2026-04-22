import * as vscode from 'vscode';
import * as path from 'path';
import type { AgentSummary } from '../shared/message-types';
import * as alephApi from '../config/alephnet-api';
import { getAlephNetStatus } from '../config/alephnet-manager';
import { COMMANDS } from '../shared/constants';

export type ExplorerNodeType = 'virtual-root' | 'workspace-root' | 'file' | 'directory' | 'obotovs-item' | 'task-group' | 'task-item' | 'alephnet-category' | 'alephnet-item';

const MIME_TYPE = 'application/vnd.code.tree.obotovs.explorer';

export class ExplorerNode extends vscode.TreeItem {
  readonly nodeType: ExplorerNodeType;
  agentId?: string;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    nodeType: ExplorerNodeType,
    resourceUri?: vscode.Uri,
    iconPath?: vscode.TreeItem['iconPath'],
    command?: vscode.Command
  ) {
    if (resourceUri) {
      super(resourceUri, collapsibleState);
      if (nodeType === 'workspace-root') {
        this.label = label;
      }
    } else {
      super(label, collapsibleState);
    }

    this.nodeType = nodeType;
    if (iconPath) {
      this.iconPath = iconPath;
    }
    if (command) {
      this.command = command;
    }
  }
}

export interface AgentSummaryProvider {
  listAll(): AgentSummary[];
}

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.TreeDragAndDropController<ExplorerNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<ExplorerNode | undefined | void> = new vscode.EventEmitter<ExplorerNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ExplorerNode | undefined | void> = this._onDidChangeTreeData.event;

  readonly dropMimeTypes = [MIME_TYPE, 'text/uri-list'];
  readonly dragMimeTypes = [MIME_TYPE];

  private _watcher: vscode.FileSystemWatcher;
  private agentProvider?: AgentSummaryProvider;
  private treeView?: vscode.TreeView<ExplorerNode>;

  constructor() {
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this._watcher.onDidCreate(() => this.refresh());
    this._watcher.onDidChange(() => this.refresh());
    this._watcher.onDidDelete(() => this.refresh());
  }

  createTreeView(): vscode.TreeView<ExplorerNode> {
    this.treeView = vscode.window.createTreeView('obotovs.explorer', {
      treeDataProvider: this,
      canSelectMany: true,
      dragAndDropController: this,
      showCollapseAll: true,
    });
    return this.treeView;
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────

  handleDrag(source: readonly ExplorerNode[], dataTransfer: vscode.DataTransfer): void {
    const draggable = source.filter(n => n.resourceUri && (n.nodeType === 'file' || n.nodeType === 'directory' || n.nodeType === 'obotovs-item'));
    if (draggable.length === 0) return;
    dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem(draggable.map(n => n.resourceUri!.toString())));
  }

  async handleDrop(target: ExplorerNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!target?.resourceUri) return;

    const targetIsDir = target.nodeType === 'directory' || target.nodeType === 'workspace-root';
    const destDir = targetIsDir ? target.resourceUri : vscode.Uri.file(path.dirname(target.resourceUri.fsPath));

    // Handle internal tree drops
    const internal = dataTransfer.get(MIME_TYPE);
    if (internal) {
      const uris: string[] = internal.value;
      for (const uriStr of uris) {
        const sourceUri = vscode.Uri.parse(uriStr);
        const name = path.basename(sourceUri.fsPath);
        const destUri = vscode.Uri.joinPath(destDir, name);
        if (sourceUri.toString() === destUri.toString()) continue;
        try {
          await vscode.workspace.fs.rename(sourceUri, destUri, { overwrite: false });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to move ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.refresh();
      return;
    }

    // Handle external file drops (text/uri-list)
    const external = dataTransfer.get('text/uri-list');
    if (external) {
      const rawValue = external.value;
      const uriStrings = typeof rawValue === 'string' ? rawValue.split('\n').filter(Boolean) : [];
      for (const uriStr of uriStrings) {
        try {
          const sourceUri = vscode.Uri.parse(uriStr.trim());
          const name = path.basename(sourceUri.fsPath);
          const destUri = vscode.Uri.joinPath(destDir, name);
          await vscode.workspace.fs.copy(sourceUri, destUri, { overwrite: false });
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to copy: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      this.refresh();
    }
  }

  setAgentProvider(provider: AgentSummaryProvider): void {
    this.agentProvider = provider;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!element) {
      return [
        new ExplorerNode('Tasks', vscode.TreeItemCollapsibleState.Expanded, 'virtual-root', undefined, new vscode.ThemeIcon('tasklist')),
        new ExplorerNode('AlephNet', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('globe')),
        new ExplorerNode('Projects', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('project')),
        new ExplorerNode('Surfaces', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('browser')),
        new ExplorerNode('Routes', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('symbol-event')),
        new ExplorerNode('Conversations', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('comment-discussion')),
        new ExplorerNode('Skills', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('tools')),
        new ExplorerNode('Workspace', vscode.TreeItemCollapsibleState.Expanded, 'virtual-root', undefined, new vscode.ThemeIcon('folder-library'))
      ];
    }

    if (element.nodeType === 'virtual-root') {
      if (element.label === 'Tasks') {
        return this.getTaskChildren();
      }

      if (element.label === 'AlephNet') {
        return this.getAlephNetChildren();
      }

      if (element.label === 'Workspace') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          return [];
        }
        if (workspaceFolders.length === 1) {
          return this.getFileSystemChildren(workspaceFolders[0].uri);
        }
        return workspaceFolders.map(folder => {
          const node = new ExplorerNode(
            folder.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            'workspace-root',
            folder.uri,
            new vscode.ThemeIcon('folder')
          );
          node.contextValue = 'workspaceRoot';
          return node;
        });
      } else {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return [];

        const rootUri = workspaceFolders[0].uri;
        let subfolder = '';
        let category = '';

        switch (element.label) {
          case 'Surfaces': subfolder = 'surfaces'; category = 'surface'; break;
          case 'Routes': subfolder = 'routes'; category = 'route'; break;
          case 'Conversations': subfolder = 'conversations'; category = 'conversation'; break;
          case 'Skills': subfolder = 'skills'; category = 'skill'; break;
          case 'Projects': subfolder = 'projects'; category = 'project'; break;
        }

        const obotovsDir = vscode.Uri.joinPath(rootUri, '.obotovs', subfolder);
        return this.getFileSystemChildren(obotovsDir, category);
      }
    }

    if (element.nodeType === 'task-group') {
      return this.getTaskGroupChildren(element.label as string);
    }

    if (element.nodeType === 'alephnet-category') {
      return this.getAlephNetCategoryChildren(element.label as string);
    }

    if (element.nodeType === 'workspace-root' || element.nodeType === 'directory') {
      if (element.resourceUri) {
        return this.getFileSystemChildren(element.resourceUri);
      }
    }

    return [];
  }

  private getTaskChildren(): ExplorerNode[] {
    if (!this.agentProvider) {
      const node = new ExplorerNode('No agent provider', vscode.TreeItemCollapsibleState.None, 'task-item', undefined, new vscode.ThemeIcon('info'));
      node.description = 'Agent not initialized';
      return [node];
    }

    const agents = this.agentProvider.listAll();
    const running = agents.filter(a => a.status === 'running');
    const idle = agents.filter(a => a.status === 'idle');
    const completed = agents.filter(a => a.status === 'complete');
    const failed = agents.filter(a => a.status === 'error' || a.status === 'cancelled');

    const groups: ExplorerNode[] = [];

    if (running.length > 0) {
      const node = new ExplorerNode(
        'Running',
        vscode.TreeItemCollapsibleState.Expanded,
        'task-group',
        undefined,
        new vscode.ThemeIcon('sync~spin'),
      );
      node.description = `${running.length}`;
      groups.push(node);
    }

    if (idle.length > 0) {
      const node = new ExplorerNode(
        'Idle',
        vscode.TreeItemCollapsibleState.Expanded,
        'task-group',
        undefined,
        new vscode.ThemeIcon('circle-outline'),
      );
      node.description = `${idle.length}`;
      groups.push(node);
    }

    if (completed.length > 0) {
      const node = new ExplorerNode(
        'Completed',
        vscode.TreeItemCollapsibleState.Collapsed,
        'task-group',
        undefined,
        new vscode.ThemeIcon('check'),
      );
      node.description = `${completed.length}`;
      groups.push(node);
    }

    if (failed.length > 0) {
      const node = new ExplorerNode(
        'Failed',
        vscode.TreeItemCollapsibleState.Collapsed,
        'task-group',
        undefined,
        new vscode.ThemeIcon('error'),
      );
      node.description = `${failed.length}`;
      groups.push(node);
    }

    if (groups.length === 0) {
      const node = new ExplorerNode('No tasks', vscode.TreeItemCollapsibleState.None, 'task-item', undefined, new vscode.ThemeIcon('circle-outline'));
      node.description = 'Spawn agents to see them here';
      return [node];
    }

    return groups;
  }

  private getTaskGroupChildren(groupLabel: string): ExplorerNode[] {
    if (!this.agentProvider) return [];

    const agents = this.agentProvider.listAll();
    let filtered: AgentSummary[];

    switch (groupLabel) {
      case 'Running':
        filtered = agents.filter(a => a.status === 'running');
        break;
      case 'Idle':
        filtered = agents.filter(a => a.status === 'idle');
        break;
      case 'Completed':
        filtered = agents.filter(a => a.status === 'complete');
        break;
      case 'Failed':
        filtered = agents.filter(a => a.status === 'error' || a.status === 'cancelled');
        break;
      default:
        filtered = [];
    }

    return filtered.map(agent => {
      const icon = agent.status === 'running'
        ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'))
        : agent.status === 'idle'
        ? new vscode.ThemeIcon('circle-outline')
        : agent.status === 'complete'
        ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
        : new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));

      const node = new ExplorerNode(
        agent.label,
        vscode.TreeItemCollapsibleState.None,
        'task-item',
        undefined,
        icon,
      );

      const model = agent.model.model;
      const cost = agent.cost.totalCost > 0 ? ` · $${agent.cost.totalCost.toFixed(4)}` : '';
      const depth = agent.depth > 0 ? ` · depth ${agent.depth}` : '';
      node.description = `${model}${cost}${depth}`;

      if (agent.task) {
        node.tooltip = agent.task;
      }

      node.agentId = agent.id;
      node.contextValue = agent.status === 'running' ? 'taskRunning'
        : agent.status === 'idle' ? 'taskIdle'
        : agent.status === 'complete' ? 'taskCompleted'
        : 'taskFailed';

      return node;
    });
  }

  private async getFileSystemChildren(dirUri: vscode.Uri, category: string = ''): Promise<ExplorerNode[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);

      entries.sort((a, b) => {
        if (a[1] === b[1]) {
          return a[0].localeCompare(b[0]);
        }
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      });

      return entries.map(([name, type]) => {
        const itemUri = vscode.Uri.joinPath(dirUri, name);
        const isDir = type === vscode.FileType.Directory;

        let command: vscode.Command | undefined;

        if (!isDir) {
          if (category === 'surface' && name.endsWith('.html')) {
            const surfaceName = name.replace(/\.html$/, '');
            command = {
              command: 'obotovs.openSurface',
              title: 'Open Surface',
              arguments: [surfaceName]
            };
          } else {
            command = {
              command: 'vscode.open',
              title: 'Open File',
              arguments: [itemUri]
            };
          }
        }

        const isObotovsItem = !!category;
        const node = new ExplorerNode(
          name,
          isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          isDir ? 'directory' : (isObotovsItem ? 'obotovs-item' : 'file'),
          itemUri,
          undefined,
          command
        );

        if (isDir) {
          node.contextValue = category ? `${category}Dir` : 'directory';
        } else if (category) {
          node.contextValue = `${category}File`;
        } else {
          node.contextValue = 'workspaceFile';
        }

        return node;
      });
    } catch (error) {
      return [];
    }
  }

  // ── AlephNet Tree ──────────────────────────────────────────────────

  private async getAlephNetChildren(): Promise<ExplorerNode[]> {
    const status = await getAlephNetStatus();

    if (!status.connected) {
      const node = new ExplorerNode(
        'Not connected',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('warning'),
      );
      node.description = `port ${status.port}`;
      node.tooltip = 'AlephNet node is not running. Enable it in settings (obotovs.alephnet.enabled).';
      return [node];
    }

    const meNode = new ExplorerNode(
      'Me',
      vscode.TreeItemCollapsibleState.None,
      'alephnet-category',
      undefined,
      new vscode.ThemeIcon('account'),
      { command: COMMANDS.ALEPHNET_OPEN_PROFILE, title: 'Open AlephNet Profile' },
    );
    meNode.contextValue = 'alephnetProfile';

    const identity = await alephApi.getIdentity();
    if (identity) {
      meNode.description = identity.name || identity.nodeId?.slice(0, 12) || '';
    }

    const friendsNode = new ExplorerNode(
      'Friends',
      vscode.TreeItemCollapsibleState.Collapsed,
      'alephnet-category',
      undefined,
      new vscode.ThemeIcon('people'),
    );
    friendsNode.contextValue = 'alephnetFriends';

    const groupsNode = new ExplorerNode(
      'Groups',
      vscode.TreeItemCollapsibleState.Collapsed,
      'alephnet-category',
      undefined,
      new vscode.ThemeIcon('organization'),
    );
    groupsNode.contextValue = 'alephnetGroups';

    const scriptsNode = new ExplorerNode(
      'Scripts (SRIA)',
      vscode.TreeItemCollapsibleState.Collapsed,
      'alephnet-category',
      undefined,
      new vscode.ThemeIcon('symbol-misc'),
    );
    scriptsNode.contextValue = 'alephnetScripts';

    const networkNode = new ExplorerNode(
      'Network',
      vscode.TreeItemCollapsibleState.Collapsed,
      'alephnet-category',
      undefined,
      new vscode.ThemeIcon('remote'),
    );
    networkNode.contextValue = 'alephnetNetwork';

    return [meNode, friendsNode, groupsNode, scriptsNode, networkNode];
  }

  private async getAlephNetCategoryChildren(label: string): Promise<ExplorerNode[]> {
    switch (label) {
      case 'Friends':
        return this.getAlephNetFriends();
      case 'Groups':
        return this.getAlephNetGroups();
      case 'Scripts (SRIA)':
        return this.getAlephNetScripts();
      case 'Network':
        return this.getAlephNetNetwork();
      default:
        return [];
    }
  }

  private async getAlephNetFriends(): Promise<ExplorerNode[]> {
    const nodes = await alephApi.getNodes();
    if (nodes.length === 0) {
      const empty = new ExplorerNode(
        'No friends yet',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('circle-outline'),
      );
      empty.description = 'Connect to peers on the network';
      return [empty];
    }
    return nodes.map(peer => {
      const node = new ExplorerNode(
        peer.name || peer.nodeId?.slice(0, 16) || 'Unknown',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('person'),
      );
      node.description = peer.status || peer.address || '';
      node.tooltip = `Node: ${peer.nodeId}\n${peer.address ? `Address: ${peer.address}` : ''}${peer.lastSeen ? `\nLast seen: ${peer.lastSeen}` : ''}`;
      node.contextValue = 'alephnetFriend';
      return node;
    });
  }

  private async getAlephNetGroups(): Promise<ExplorerNode[]> {
    const empty = new ExplorerNode(
      'No groups yet',
      vscode.TreeItemCollapsibleState.None,
      'alephnet-item',
      undefined,
      new vscode.ThemeIcon('circle-outline'),
    );
    empty.description = 'Groups will appear here';
    return [empty];
  }

  private async getAlephNetScripts(): Promise<ExplorerNode[]> {
    const topics = await alephApi.getLearningTopics();
    const learningStatus = await alephApi.getLearningStatus();

    const items: ExplorerNode[] = [];

    if (learningStatus) {
      const statusNode = new ExplorerNode(
        learningStatus.active ? 'Learning Active' : 'Learning Idle',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        learningStatus.active
          ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'))
          : new vscode.ThemeIcon('circle-outline'),
      );
      if (learningStatus.topic) {
        statusNode.description = learningStatus.topic;
      }
      statusNode.contextValue = 'alephnetLearningStatus';
      items.push(statusNode);
    }

    if (topics.length === 0 && items.length === 0) {
      const empty = new ExplorerNode(
        'No scripts',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('circle-outline'),
      );
      empty.description = 'SRIA learning topics appear here';
      return [empty];
    }

    for (const t of topics) {
      const node = new ExplorerNode(
        t.topic,
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('beaker'),
      );
      if (t.progress !== undefined) {
        node.description = `${Math.round(t.progress * 100)}%`;
      }
      node.contextValue = 'alephnetScript';
      items.push(node);
    }

    return items;
  }

  private async getAlephNetNetwork(): Promise<ExplorerNode[]> {
    const status = await alephApi.getStatus();
    const nodes = await alephApi.getNodes();

    const items: ExplorerNode[] = [];

    if (status) {
      const statusNode = new ExplorerNode(
        'Node Status',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('pulse'),
      );
      const conns = status.connections ?? nodes.length;
      statusNode.description = `${conns} connection${conns === 1 ? '' : 's'}`;
      if (status.nodeId) {
        statusNode.tooltip = `Node ID: ${status.nodeId}`;
      }
      statusNode.contextValue = 'alephnetNodeStatus';
      items.push(statusNode);
    }

    for (const peer of nodes) {
      const node = new ExplorerNode(
        peer.name || peer.nodeId?.slice(0, 16) || 'Peer',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('vm'),
      );
      node.description = peer.address || peer.status || '';
      node.tooltip = peer.nodeId || '';
      node.contextValue = 'alephnetPeer';
      items.push(node);
    }

    if (items.length === 0) {
      const empty = new ExplorerNode(
        'No peers',
        vscode.TreeItemCollapsibleState.None,
        'alephnet-item',
        undefined,
        new vscode.ThemeIcon('circle-outline'),
      );
      empty.description = 'No network peers connected';
      return [empty];
    }

    return items;
  }

  dispose() {
    this._watcher.dispose();
  }
}
