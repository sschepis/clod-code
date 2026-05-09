import type { GunRelayServer } from '../peers/gun-relay';

export interface RelayToolDeps {
  server: GunRelayServer;
}

export function createRelayStartHandler(deps: RelayToolDeps) {
  return async (args: Record<string, unknown>) => {
    const port = typeof args.port === 'number' ? args.port : 8765;
    try {
      await deps.server.start(port);
      return `Gun relay server started on port ${port}`;
    } catch (err: any) {
      return `Failed to start Gun relay server: ${err.message || String(err)}`;
    }
  };
}

export function createRelayStopHandler(deps: RelayToolDeps) {
  return async () => {
    await deps.server.stop();
    return 'Gun relay server stopped';
  };
}

export function createRelayStatusHandler(deps: RelayToolDeps) {
  return async () => {
    const status = deps.server.status();
    if (status.running) {
      return `Gun relay server is running on port ${status.port}`;
    } else {
      return 'Gun relay server is stopped';
    }
  };
}
