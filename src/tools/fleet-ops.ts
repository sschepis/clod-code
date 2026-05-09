/**
 * Fleet monitoring tools — connect to the ALEPH-PRIME P2P mesh and expose
 * fleet state (pod heartbeats, events, conductor/mechanic status) to
 * agents and surfaces.
 */

export interface FleetToolDeps {
  getMesh: () => FleetMeshState | null;
}

export interface FleetMeshState {
  pods: Map<string, PodState>;
  events: MeshEvent[];
  conductor: ConductorState | null;
  mechanic: MechanicState | null;
  connected: boolean;
  peerCount: number;
  broadcast: (type: string, payload: unknown) => void;
}

interface PodState {
  nodeId: string;
  role: string;
  uptime: number;
  peerCount: number;
  memoryMB: number;
  lastSeen: number;
}

interface MeshEvent {
  id: string;
  type: string;
  source: string;
  timestamp: number;
  payload?: unknown;
}

interface ConductorState {
  burnRate: number;
  entropy: number;
  peerCount: number;
  lastCheck: number;
}

interface MechanicState {
  activeRepair: string | null;
  repairStarted: number | null;
  completed: number;
  failed: number;
  lastFix: number | null;
}

function formatPod(pod: PodState): string {
  const ago = Math.round((Date.now() - pod.lastSeen) / 1000);
  const status = ago < 30 ? 'ONLINE' : ago < 60 ? 'STALE' : 'OFFLINE';
  return `  ${pod.nodeId} (${pod.role}): ${status} | uptime=${pod.uptime}s | peers=${pod.peerCount} | mem=${pod.memoryMB}MB | last_seen=${ago}s ago`;
}

export function createFleetStatusHandler(deps: FleetToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const mesh = deps.getMesh();
    if (!mesh) return '[ERROR] Fleet mesh not connected. Ensure MESH_PEERS is configured.';

    const lines: string[] = [];
    lines.push(`Fleet Status (connected=${mesh.connected}, peers=${mesh.peerCount})`);
    lines.push('');

    lines.push('Pods:');
    if (mesh.pods.size === 0) {
      lines.push('  No pods reporting. Waiting for heartbeats...');
    } else {
      for (const pod of mesh.pods.values()) {
        lines.push(formatPod(pod));
      }
    }
    lines.push('');

    if (mesh.conductor) {
      const c = mesh.conductor;
      const ago = Math.round((Date.now() - c.lastCheck) / 1000);
      lines.push(`Conductor: burn=$${c.burnRate.toFixed(3)}/hr | entropy=${c.entropy.toFixed(3)} | check=${ago}s ago`);
    } else {
      lines.push('Conductor: No status received yet');
    }

    if (mesh.mechanic) {
      const m = mesh.mechanic;
      const total = m.completed + m.failed;
      const rate = total > 0 ? Math.round((m.completed / total) * 100) : 0;
      const active = m.activeRepair ? `REPAIRING ${m.activeRepair}` : 'idle';
      lines.push(`Mechanic: ${active} | success_rate=${rate}% (${m.completed}/${total}) | last_fix=${m.lastFix ? Math.round((Date.now() - m.lastFix) / 1000) + 's ago' : 'never'}`);
    } else {
      lines.push('Mechanic: No status received yet');
    }

    return lines.join('\n');
  };
}

export function createFleetEventsHandler(deps: FleetToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const mesh = deps.getMesh();
    if (!mesh) return '[ERROR] Fleet mesh not connected.';

    const limit = Math.min(Number(kwargs.limit) || 50, 200);
    const typeFilter = kwargs.type ? String(kwargs.type) : null;

    let events = mesh.events;
    if (typeFilter) {
      events = events.filter(e => e.type === typeFilter);
    }
    events = events.slice(-limit);

    if (events.length === 0) {
      return 'No mesh events recorded yet.';
    }

    const lines = events.map(e => {
      const ts = new Date(e.timestamp).toISOString().slice(11, 23);
      const payload = e.payload ? JSON.stringify(e.payload).slice(0, 100) : '';
      return `${ts}  ${e.source.padEnd(12)}  ${e.type.padEnd(24)}  ${payload}`;
    });

    return `Fleet Events (${events.length} shown):\n${lines.join('\n')}`;
  };
}

export function createFleetPodsHandler(deps: FleetToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const mesh = deps.getMesh();
    if (!mesh) return '[ERROR] Fleet mesh not connected.';

    const podId = kwargs.pod ? String(kwargs.pod) : null;

    if (podId) {
      const pod = mesh.pods.get(podId);
      if (!pod) return `[ERROR] Pod "${podId}" not found. Known pods: ${[...mesh.pods.keys()].join(', ')}`;
      return JSON.stringify(pod, null, 2);
    }

    if (mesh.pods.size === 0) return 'No pods reporting heartbeats yet.';

    const lines: string[] = [];
    for (const pod of mesh.pods.values()) {
      lines.push(formatPod(pod));
    }
    return lines.join('\n');
  };
}

export function createFleetBroadcastHandler(deps: FleetToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const mesh = deps.getMesh();
    if (!mesh) return '[ERROR] Fleet mesh not connected.';

    const type = String(kwargs.type || '').trim();
    if (!type) return '[ERROR] Missing required arg: type (the mesh message type to broadcast)';

    let payload: unknown;
    if (kwargs.payload) {
      if (typeof kwargs.payload === 'string') {
        try { payload = JSON.parse(kwargs.payload); } catch { payload = kwargs.payload; }
      } else {
        payload = kwargs.payload;
      }
    }

    mesh.broadcast(type, payload);
    return `[SUCCESS] Broadcast sent: type="${type}"`;
  };
}
