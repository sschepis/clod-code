import * as vscode from 'vscode';

export type ExplorerNodeType = 'virtual-root' | 'workspace-root' | 'file' | 'directory' | 'clodcode-item';

export class ExplorerNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly nodeType: ExplorerNodeType,
    resourceUri?: vscode.Uri,
    iconPath?: string | vscode.ThemeIcon | { light: string | vscode.Uri; dark: string | vscode.Uri },
    command?: vscode.Command
  ) {
    super(resourceUri || label, collapsibleState);
    if (resourceUri) {
      this.resourceUri = resourceUri;
      // When passing resourceUri, super() ignores the label parameter. 
      // We must explicitly set it if we want a custom label, 
      // but for files we usually want the default resource label anyway.
      // Setting it to undefined ensures the file name is used.
      if (nodeType === 'workspace-root') {
         this.label = label;
      }
    } else {
      this.label = label;
    }
    
    if (iconPath) {
      this.iconPath = iconPath;
    }
    if (command) {
      this.command = command;
    }
  }
}

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<ExplorerNode | undefined | void> = new vscode.EventEmitter<ExplorerNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ExplorerNode | undefined | void> = this._onDidChangeTreeData.event;


  private _watcher: vscode.FileSystemWatcher;

  constructor() {
    // Watch for file changes in the workspace
    this._watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this._watcher.onDidCreate(() => this.refresh());
    this._watcher.onDidChange(() => this.refresh());
    this._watcher.onDidDelete(() => this.refresh());
  }

  refresh(): void {

    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!element) {
      // Root level
      return [
        new ExplorerNode('Surfaces', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('browser')),
        new ExplorerNode('Routes', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('symbol-event')),
        new ExplorerNode('Conversations', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('comment-discussion')),
        new ExplorerNode('Skills', vscode.TreeItemCollapsibleState.Collapsed, 'virtual-root', undefined, new vscode.ThemeIcon('tools')),
        new ExplorerNode('Workspace', vscode.TreeItemCollapsibleState.Expanded, 'virtual-root', undefined, new vscode.ThemeIcon('folder-library'))
      ];
    }

    if (element.nodeType === 'virtual-root') {
      if (element.label === 'Workspace') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          return [];
        }
        if (workspaceFolders.length === 1) {
          // If only one workspace folder, skip the folder level and show its contents
          return this.getFileSystemChildren(workspaceFolders[0].uri);
        }
        return workspaceFolders.map(folder => 
          new ExplorerNode(
            folder.name,
            vscode.TreeItemCollapsibleState.Collapsed,
            'workspace-root',
            folder.uri,
            new vscode.ThemeIcon('folder')
          )
        );
      } else {
        // Handle .clodcode folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return [];
        
        const rootUri = workspaceFolders[0].uri;
        let subfolder = '';
        
        switch (element.label) {
          case 'Surfaces': subfolder = 'surfaces'; break;
          case 'Routes': subfolder = 'routes'; break;
          case 'Conversations': subfolder = 'conversations'; break;
          case 'Skills': subfolder = 'skills'; break;
        }

        const clodcodeDir = vscode.Uri.joinPath(rootUri, '.clodcode', subfolder);
        return this.getFileSystemChildren(clodcodeDir, true);
      }
    }

    if (element.nodeType === 'workspace-root' || element.nodeType === 'directory') {
      if (element.resourceUri) {
        return this.getFileSystemChildren(element.resourceUri);
      }
    }

    return [];
  }

  private async getFileSystemChildren(dirUri: vscode.Uri, isClodcodeItem: boolean = false): Promise<ExplorerNode[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      
      // Sort: directories first, then files
      entries.sort((a, b) => {
        if (a[1] === b[1]) {
          return a[0].localeCompare(b[0]);
        }
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      });

      return entries.map(([name, type]) => {
        const itemUri = vscode.Uri.joinPath(dirUri, name);
        const isDir = type === vscode.FileType.Directory;
        
        let iconPath: vscode.ThemeIcon | undefined;
        let command: vscode.Command | undefined;

        if (!isDir) {
          command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [itemUri]
          };
        }

        return new ExplorerNode(
          name,
          isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          isDir ? 'directory' : (isClodcodeItem ? 'clodcode-item' : 'file'),
          itemUri,
          iconPath,
          command
        );
      });
    } catch (error) {
      // Directory might not exist yet
      return [];
    }
  }

  dispose() {
    this._watcher.dispose();
  }
}
