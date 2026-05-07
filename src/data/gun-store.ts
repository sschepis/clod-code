import * as path from 'path';

const GUN_DATA_DIR = '.obotovs/gun-data';

export interface GunStoreOptions {
  workspaceRoot: string;
  relayPeers?: string[];
}

export class GunStore {
  private gun: any;

  constructor(opts: GunStoreOptions) {
    // Dynamic require to avoid bundling issues and strict type problems
    const Gun = require('gun');
    const filePath = path.join(opts.workspaceRoot, GUN_DATA_DIR);
    const peers = opts.relayPeers?.filter(Boolean) ?? [];
    this.gun = Gun({
      file: filePath,
      peers: peers.length > 0 ? peers : undefined,
      localStorage: false,
      radisk: true,
    });
  }

  /** Get a reference to a path in the graph. */
  ref(nodePath: string): any {
    const parts = nodePath.split('/').filter(Boolean);
    let node = this.gun.get(parts[0] || 'root');
    for (let i = 1; i < parts.length; i++) {
      node = node.get(parts[i]);
    }
    return node;
  }

  /** Read a value at a path. Returns a promise. */
  async get(nodePath: string): Promise<unknown> {
    return new Promise((resolve) => {
      this.ref(nodePath).once((data: any) => {
        resolve(data ?? null);
      });
    });
  }

  /** Write a value at a path. */
  async put(nodePath: string, data: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ref(nodePath).put(data, (ack: any) => {
        if (ack.err) reject(new Error(String(ack.err)));
        else resolve();
      });
    });
  }

  /** Set a value on a set (append to a collection). */
  async add(collectionPath: string, data: Record<string, unknown>): Promise<string> {
    return new Promise((resolve) => {
      const ref = this.ref(collectionPath).set(data);
      resolve(ref._.get || 'unknown');
    });
  }

  /** Subscribe to changes at a path. Returns an unsubscribe function. */
  on(nodePath: string, callback: (data: unknown, key: string) => void): () => void {
    const ref = this.ref(nodePath);
    ref.on((data: any, key: string) => {
      callback(data, key);
    });
    return () => ref.off();
  }

  /** List children of a path (one level). */
  async list(nodePath: string): Promise<Array<{ key: string; value: unknown }>> {
    return new Promise((resolve) => {
      const results: Array<{ key: string; value: unknown }> = [];
      const ref = this.ref(nodePath);
      ref.map().once((data: any, key: string) => {
        if (data !== undefined && data !== null) {
          results.push({ key, value: data });
        }
      });
      setTimeout(() => resolve(results), 100);
    });
  }

  /** Delete a node at a path (sets to null). */
  async delete(nodePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ref(nodePath).put(null, (ack: any) => {
        if (ack.err) reject(new Error(String(ack.err)));
        else resolve();
      });
    });
  }

  /** Get the raw Gun instance for advanced usage. */
  raw(): any {
    return this.gun;
  }

  dispose(): void {
    try { (this.gun as any).off?.(); } catch { /* ignore */ }
  }
}
