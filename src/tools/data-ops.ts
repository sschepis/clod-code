import type { GunStore } from '../data/gun-store';

export interface DataToolDeps {
  store: GunStore;
}

export function createDataGetHandler(deps: DataToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const nodePath = String(kwargs.path || '').trim();
    if (!nodePath) return '[ERROR] Missing required argument: path';

    try {
      const data = await deps.store.get(nodePath);
      return JSON.stringify(data, null, 2) ?? 'null';
    } catch (err) {
      return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createDataPutHandler(deps: DataToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const nodePath = String(kwargs.path || '').trim();
    if (!nodePath) return '[ERROR] Missing required argument: path';
    if (kwargs.data === undefined) return '[ERROR] Missing required argument: data';

    const data = typeof kwargs.data === 'object' && kwargs.data !== null
      ? kwargs.data as Record<string, unknown>
      : { value: kwargs.data };

    try {
      await deps.store.put(nodePath, data);
      return `[SUCCESS] Data written to "${nodePath}".`;
    } catch (err) {
      return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createDataDeleteHandler(deps: DataToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const nodePath = String(kwargs.path || '').trim();
    if (!nodePath) return '[ERROR] Missing required argument: path';

    try {
      await deps.store.delete(nodePath);
      return `[SUCCESS] Deleted data at "${nodePath}".`;
    } catch (err) {
      return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createDataListHandler(deps: DataToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const nodePath = String(kwargs.path || '').trim();
    if (!nodePath) return '[ERROR] Missing required argument: path';

    try {
      const items = await deps.store.list(nodePath);
      if (items.length === 0) return `No items found at "${nodePath}".`;
      return items.map((item) => `${item.key}: ${JSON.stringify(item.value)}`).join('\n');
    } catch (err) {
      return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createDataAddHandler(deps: DataToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const collection = String(kwargs.collection || '').trim();
    if (!collection) return '[ERROR] Missing required argument: collection';
    if (kwargs.data === undefined) return '[ERROR] Missing required argument: data';

    const data = typeof kwargs.data === 'object' && kwargs.data !== null
      ? kwargs.data as Record<string, unknown>
      : { value: kwargs.data };

    try {
      const id = await deps.store.add(collection, data);
      return `[SUCCESS] Added to "${collection}" with id "${id}".`;
    } catch (err) {
      return `[ERROR] ${err instanceof Error ? err.message : String(err)}`;
    }
  };
}

export function createDataHandlers(deps: DataToolDeps) {
  return {
    get: createDataGetHandler(deps),
    put: createDataPutHandler(deps),
    delete: createDataDeleteHandler(deps),
    list: createDataListHandler(deps),
    add: createDataAddHandler(deps),
  };
}
