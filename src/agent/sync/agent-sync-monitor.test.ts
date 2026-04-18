import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { initEncoder } from '../memory/encoding';
import { AgentSyncMonitor, crossSync } from './agent-sync-monitor';

beforeAll(async () => {
  await initEncoder();
});

describe('crossSync', () => {
  it('returns > 0.9 for identical excitation patterns', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    // Access internal models by registering two agents and ingesting the same text
    monitor.registerAgent('a');
    monitor.registerAgent('b');

    // Use the public API to excite identically
    monitor.ingestContent('a', 'implement React login page TypeScript');
    monitor.ingestContent('b', 'implement React login page TypeScript');

    // Access models via the internal map for direct crossSync test
    const models = (monitor as any).models as Map<string, any>;
    const modelA = models.get('a')!;
    const modelB = models.get('b')!;

    const score = crossSync(modelA, modelB);
    expect(score).toBeGreaterThan(0.9);
    monitor.dispose();
  });

  it('returns 0 for non-overlapping excitations', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    monitor.registerAgent('a');
    monitor.registerAgent('b');

    // Excite with very different content
    // Use single unique words to maximize disjoint prime sets
    monitor.ingestContent('a', 'zephyr');
    monitor.ingestContent('b', 'quasar');

    const models = (monitor as any).models as Map<string, any>;
    const modelA = models.get('a')!;
    const modelB = models.get('b')!;

    const score = crossSync(modelA, modelB);
    // Should be 0 or very low — different tokens hit different primes
    expect(score).toBeLessThan(0.3);
    monitor.dispose();
  });

  it('returns 0 when no oscillators are excited', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    monitor.registerAgent('a');
    monitor.registerAgent('b');

    const models = (monitor as any).models as Map<string, any>;
    const score = crossSync(models.get('a')!, models.get('b')!);
    expect(score).toBe(0);
    monitor.dispose();
  });
});

describe('AgentSyncMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ingestContent excites oscillators', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    monitor.registerAgent('test');

    monitor.ingestContent('test', 'implement database migration schema');

    const models = (monitor as any).models as Map<string, any>;
    const model = models.get('test')!;
    const amps: number[] = model.oscillators.map((o: any) => o.amplitude);
    const excited = amps.filter((a: number) => a > 0);
    expect(excited.length).toBeGreaterThan(0);
    monitor.dispose();
  });

  it('unregisterAgent removes model', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    monitor.registerAgent('test');
    expect((monitor as any).models.size).toBe(1);

    monitor.unregisterAgent('test');
    expect((monitor as any).models.size).toBe(0);
    monitor.dispose();
  });

  it('debounce fires callback after quiet period', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const monitor = await AgentSyncMonitor.create(callback);
    monitor.registerAgent('a');
    monitor.registerAgent('b');

    monitor.ingestContent('a', 'hello world test');

    // Should not fire immediately
    expect(callback).not.toHaveBeenCalled();

    // Advance past debounce (2000ms)
    vi.advanceTimersByTime(2100);

    expect(callback).toHaveBeenCalledTimes(1);
    const metrics = callback.mock.calls[0][0];
    expect(Array.isArray(metrics)).toBe(true);
    monitor.dispose();
  });

  it('similar text produces meaningful sync between two agents', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    monitor.registerAgent('a');
    monitor.registerAgent('b');

    // Ingest similar content (shared tokens → shared primes)
    monitor.ingestContent('a', 'implement login page React TypeScript authentication');
    monitor.ingestContent('b', 'implement login page React TypeScript validation');

    const models = (monitor as any).models as Map<string, any>;
    const score = crossSync(models.get('a')!, models.get('b')!);
    // Shared tokens (implement, login, page, react, typescript) should produce some sync
    expect(score).toBeGreaterThan(0);
    monitor.dispose();
  });

  it('dissimilar text produces low sync', async () => {
    const monitor = await AgentSyncMonitor.create(() => {});
    monitor.registerAgent('a');
    monitor.registerAgent('b');

    monitor.ingestContent('a', 'PostgreSQL database migration schemas tables');
    monitor.ingestContent('b', 'CSS animation keyframes hover transition effects');

    const models = (monitor as any).models as Map<string, any>;
    const score = crossSync(models.get('a')!, models.get('b')!);
    // Disjoint topics should produce low sync
    expect(score).toBeLessThan(0.5);
    monitor.dispose();
  });
});
