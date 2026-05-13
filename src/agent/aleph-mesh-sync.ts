import type { AgentEventBus } from '@sschepis/oboto-agent';
import { logger } from '../shared/logger';

// @ts-ignore
import { TransportManager, WebSocketTransport } from '@aleph-ai/tinyaleph/transport';

interface MeshMessage {
  type: string;
  pod: string;
  payload: any;
  timestamp: number;
  seq: number;
}

export class AlephMeshSync {
  private log = logger;
  private unsubscribeBus?: () => void;
  private transportManager: any;
  private podName: string;
  private outbox: MeshMessage[] = [];
  private seq = 0;
  private draining = false;
  private static readonly MAX_OUTBOX_SIZE = 200;

  constructor(private bus: AgentEventBus) {
    this.podName = process.env.POD_NAME || 'UnknownPod';
    this.log.info(`Initializing AlephMeshSync for pod: ${this.podName}`);
    this.setupTransport();
    this.setupEventListeners();
  }

  private setupTransport() {
    try {
      this.transportManager = new TransportManager();

      const wsTransport = new WebSocketTransport({
        url: process.env.ALEPH_MESH_URL || 'ws://localhost:8080/mesh',
        maxReconnectAttempts: 10
      });

      this.transportManager.addTransport('ws', wsTransport);
      this.transportManager.setFallbackOrder(['ws']);

      this.transportManager.on('message', (msg: any) => {
        this.handleIncomingMeshMessage(msg);
      });

      this.transportManager.on('connected', () => {
        this.log.info(`Mesh reconnected — draining ${this.outbox.length} queued messages`);
        this.drainOutbox();
      });

      this.transportManager.connect().catch((err: Error) => {
        this.log.warn(`Failed to connect to Aleph mesh: ${err.message}`);
      });
    } catch (e) {
      this.log.error('Failed to initialize Aleph TransportManager', e);
    }
  }

  private setupEventListeners() {
    this.unsubscribeBus = this.bus.on('state_updated', (event) => {
      this.broadcastStateUpdate(event.payload);
    });

    this.bus.on('turn_complete', (event) => {
      this.broadcastRealization(event.payload);
    });

    this.bus.on('session_compacted', (event) => {
      this.broadcastCompactionSummary(event.payload);
    });
  }

  private broadcastStateUpdate(payload: any) {
    void this.queueOrSend({
      type: 'STATE_SYNC',
      pod: this.podName,
      payload,
      timestamp: Date.now(),
    });
  }

  private broadcastRealization(payload: any) {
    void this.queueOrSend({
      type: 'FLEET_REALIZATION',
      pod: this.podName,
      payload,
      timestamp: Date.now(),
    });
  }

  private broadcastCompactionSummary(payload: any) {
    void this.queueOrSend({
      type: 'COMPACTION_SUMMARY',
      pod: this.podName,
      payload: {
        summary: payload.summary,
        formattedSummary: payload.formattedSummary,
        removedMessageCount: payload.removedMessageCount,
      },
      timestamp: Date.now(),
    });
  }

  private async queueOrSend(msg: Omit<MeshMessage, 'seq'>): Promise<void> {
    const seqMsg: MeshMessage = { ...msg, seq: ++this.seq };

    if (this.transportManager?.getPrimary()) {
      if (this.outbox.length > 0) {
        await this.drainOutbox();
      }
      try {
        await this.transportManager.send(seqMsg);
        return;
      } catch (e) {
        this.log.warn(`Mesh send failed, queuing: ${(e as Error).message}`);
      }
    }

    this.outbox.push(seqMsg);
    if (this.outbox.length > AlephMeshSync.MAX_OUTBOX_SIZE) {
      this.outbox.splice(0, this.outbox.length - AlephMeshSync.MAX_OUTBOX_SIZE);
    }
  }

  private async drainOutbox(): Promise<void> {
    if (this.draining || this.outbox.length === 0) return;
    this.draining = true;
    try {
      while (this.outbox.length > 0) {
        if (!this.transportManager?.getPrimary()) {
          this.log.warn('Mesh disconnected during drain — stopping');
          break;
        }
        try {
          await this.transportManager.send(this.outbox[0]);
          this.outbox.shift();
        } catch {
          this.log.warn(`Drain send failed — ${this.outbox.length} messages remain`);
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private handleIncomingMeshMessage(msg: any) {
    if (!msg || msg.pod === this.podName) return;

    this.log.info(`Received mesh message from ${msg.pod}: ${msg.type}`);

    if (msg.type === 'FLEET_REALIZATION') {
      this.log.info(`Absorbing fleet realization from ${msg.pod}`);
      this.bus.emit('peer_realization', {
        pod: msg.pod,
        payload: msg.payload,
        seq: msg.seq,
        timestamp: msg.timestamp,
      });
    }

    if (msg.type === 'COMPACTION_SUMMARY') {
      this.log.info(`Absorbing compaction summary from ${msg.pod}: removed ${msg.payload?.removedMessageCount} messages`);
      this.bus.emit('peer_compaction', {
        pod: msg.pod,
        summary: msg.payload?.summary,
        formattedSummary: msg.payload?.formattedSummary,
        removedMessageCount: msg.payload?.removedMessageCount,
      });
    }
  }

  public dispose() {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
    }
    if (this.transportManager) {
      this.transportManager.disconnect();
    }
    this.outbox.length = 0;
  }
}
