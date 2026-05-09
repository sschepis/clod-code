import type { FleetMeshState, FleetToolDeps } from '../tools/fleet-ops';
import { logger } from '../shared/logger';

// @ts-ignore — tinyaleph transport is a JS module
import { MeshTransportManager } from '@aleph-ai/tinyaleph/transport';

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

const MAX_EVENTS = 500;

export class FleetMeshManager {
  private mesh: InstanceType<typeof MeshTransportManager> | null = null;
  private pods = new Map<string, PodState>();
  private events: MeshEvent[] = [];
  private conductor: ConductorState | null = null;
  private mechanic: MechanicState | null = null;
  private connected = false;
  private port: number;
  private peers: string[];
  private nodeId: string;
  private eventCounter = 0;
  private eventListeners: Array<(event: MeshEvent) => void> = [];

  constructor() {
    this.nodeId = process.env.MESH_NODE_ID || 'vscode-ext';
    this.port = parseInt(process.env.MESH_PORT || '4010', 10);
    this.peers = process.env.MESH_PEERS
      ? process.env.MESH_PEERS.split(',').map(s => s.trim()).filter(Boolean)
      : [];
  }

  async start(): Promise<void> {
    if (this.mesh) return;

    try {
      this.mesh = new MeshTransportManager({
        nodeId: this.nodeId,
        dedupeWindowMs: 60000,
        reconnectDelayMs: 3000,
      });

      await this.mesh.startServer({ port: this.port });
      logger.info(`[FleetMesh] Server listening on :${this.port}`);

      for (const peerUrl of this.peers) {
        await this.mesh.addPeer(peerUrl);
      }

      this.connected = true;
      this.subscribeToMeshEvents();
      logger.info(`[FleetMesh] Connected to mesh (${this.peers.length} peers configured)`);
    } catch (err) {
      logger.error('[FleetMesh] Failed to start mesh connection', err);
      this.connected = false;
    }
  }

  private subscribeToMeshEvents(): void {
    if (!this.mesh) return;

    this.mesh.subscribe('node_heartbeat', (msg: any) => {
      const p = msg.payload;
      if (!p?.nodeId) return;
      this.pods.set(p.nodeId, {
        nodeId: p.nodeId,
        role: p.role || p.nodeId,
        uptime: p.uptime || 0,
        peerCount: p.peerCount || 0,
        memoryMB: p.memoryMB || 0,
        lastSeen: Date.now(),
      });
      this.pushEvent(msg);
    });

    this.mesh.subscribe('fleet_status', (msg: any) => {
      const p = msg.payload;
      if (!p) return;
      this.conductor = {
        burnRate: p.burnRate || 0,
        entropy: p.entropy || 0,
        peerCount: p.peerCount || 0,
        lastCheck: Date.now(),
      };
      this.pushEvent(msg);
    });

    this.mesh.subscribe('mechanic_fix_started', (msg: any) => {
      const p = msg.payload;
      this.mechanic = {
        ...(this.mechanic || { completed: 0, failed: 0, lastFix: null }),
        activeRepair: p?.module || 'unknown',
        repairStarted: Date.now(),
      };
      this.pushEvent(msg);
    });

    this.mesh.subscribe('mechanic_fix_completed', (msg: any) => {
      this.mechanic = {
        activeRepair: null,
        repairStarted: null,
        completed: (this.mechanic?.completed || 0) + 1,
        failed: this.mechanic?.failed || 0,
        lastFix: Date.now(),
      };
      this.pushEvent(msg);
    });

    this.mesh.subscribe('mechanic_fix_failed', (msg: any) => {
      this.mechanic = {
        activeRepair: null,
        repairStarted: null,
        completed: this.mechanic?.completed || 0,
        failed: (this.mechanic?.failed || 0) + 1,
        lastFix: this.mechanic?.lastFix || null,
      };
      this.pushEvent(msg);
    });

    const passthroughTypes = [
      'system_error', 'conductor_error', 'node_provisioned',
      'redeploy_request', 'mechanic_terminal_output', 'fleet_directive',
    ];
    for (const type of passthroughTypes) {
      this.mesh.subscribe(type, (msg: any) => this.pushEvent(msg));
    }
  }

  private pushEvent(msg: any): void {
    const event: MeshEvent = {
      id: `evt-${++this.eventCounter}`,
      type: msg.type || 'unknown',
      source: msg.source || msg.payload?.nodeId || 'mesh',
      timestamp: msg.timestamp || Date.now(),
      payload: msg.payload,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    for (const listener of this.eventListeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  onEvent(listener: (event: MeshEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  getFleetMeshState(): FleetMeshState | null {
    if (!this.mesh || !this.connected) return null;
    const mesh = this.mesh;
    return {
      pods: new Map(this.pods),
      events: [...this.events],
      conductor: this.conductor ? { ...this.conductor } : null,
      mechanic: this.mechanic ? { ...this.mechanic } : null,
      connected: this.connected,
      peerCount: mesh.getPeerCount(),
      broadcast: (type: string, payload: unknown) => mesh.broadcast(type, payload),
    };
  }

  getFleetToolDeps(): FleetToolDeps {
    return { getMesh: () => this.getFleetMeshState() };
  }

  async shutdown(): Promise<void> {
    if (this.mesh) {
      await this.mesh.shutdown();
      this.mesh = null;
      this.connected = false;
    }
  }
}
