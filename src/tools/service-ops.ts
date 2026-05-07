import type { ServiceRegistry } from '../services/service-registry';

export interface ServiceToolDeps {
  registry: ServiceRegistry;
  promptSecret: (key: string, prompt: string) => Promise<string | undefined>;
}

export function createServiceListHandler(deps: ServiceToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const services = deps.registry.list();
    if (services.length === 0) return '[INFO] No services registered.';

    const lines = services.map(s => {
      const status = deps.registry.getStatus(s.id);
      const icon = status.configured ? '✓' : '✗';
      const detail = status.configured
        ? 'configured'
        : `missing: ${status.missingKeys.join(', ')}`;
      return `${s.id.padEnd(16)} — ${s.displayName} [${s.category}] (${icon} ${detail})`;
    });

    return `[SUCCESS] Registered services:\n${lines.join('\n')}`;
  };
}

export function createServiceConfigureHandler(deps: ServiceToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const id = kwargs.id as string | undefined;
    if (!id) return '[ERROR] Missing required parameter: id';

    const adapter = deps.registry.get(id);
    if (!adapter) return `[ERROR] Unknown service "${id}". Use service/list to see available services.`;

    const status = deps.registry.getStatus(id);
    if (status.configured) return `[SUCCESS] Service "${id}" is already configured. All required keys are set.`;

    const results: string[] = [];
    for (const key of status.missingKeys) {
      const value = await deps.promptSecret(key, `Enter ${adapter.displayName} ${key}:`);
      if (value) {
        process.env[key] = value;
        results.push(`  ${key}: set`);
      } else {
        results.push(`  ${key}: skipped`);
      }
    }

    const finalStatus = deps.registry.getStatus(id);
    if (finalStatus.configured) {
      return `[SUCCESS] Service "${id}" configured.\n${results.join('\n')}`;
    }
    return `[INFO] Service "${id}" partially configured.\n${results.join('\n')}\nStill missing: ${finalStatus.missingKeys.join(', ')}`;
  };
}

export function createServiceHandlers(deps: ServiceToolDeps) {
  return {
    list: createServiceListHandler(deps),
    configure: createServiceConfigureHandler(deps),
  };
}
