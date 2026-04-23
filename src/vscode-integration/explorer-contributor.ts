/**
 * Extension-point API for plugging new top-level categories into the
 * Oboto file explorer tree.
 *
 * Consumers implement ExplorerContributor and register it with
 * ExplorerProvider.registerContributor(). The provider owns VS Code's
 * TreeDataProvider contract; contributors return plain data objects
 * (ContributedNode) and are insulated from the vscode API.
 */

export interface ExplorerContributor {
  /** Stable id, e.g. 'alephnet'. Used for contextValue routing. */
  readonly id: string;

  /** Label shown as the root node in the tree, e.g. 'AlephNet'. */
  readonly label: string;

  /** VS Code ThemeIcon id for the root node, e.g. 'globe'. */
  readonly iconId: string;

  /** Initial collapsible state of the root. Defaults to 'collapsed'. */
  readonly initialState?: 'collapsed' | 'expanded';

  /**
   * Resolve children for this contributor's subtree.
   * - Called with `undefined` to get top-level children under the root.
   * - Called with a ContributedNode (previously returned by this
   *   contributor) to resolve its children on expand.
   */
  getChildren(node: ContributedNode | undefined): Promise<ContributedNode[]> | ContributedNode[];
}

export interface ContributedNode {
  label: string;
  collapsibleState: 'none' | 'collapsed' | 'expanded';
  iconId?: string;
  description?: string;
  tooltip?: string;
  /** Stable id scoped to this contributor — used to rehydrate children on expand. */
  contributorNodeId?: string;
  /** Context value for VS Code `when` clauses in package.json menus. */
  contextValue?: string;
  /** Command to invoke when the node is clicked. */
  command?: { command: string; title: string; arguments?: unknown[] };
  /** Opaque payload the contributor can stash for its own use. */
  data?: unknown;
}

/** Disposer returned by registerExplorerContributor. */
export interface ExplorerContributorRegistration {
  dispose(): void;
}
