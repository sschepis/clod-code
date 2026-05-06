import type { AgentEventBus } from '@sschepis/oboto-agent';
import { Logger } from '../shared/logger';

// @ts-ignore
import { TransportManager, WebSocketTransport } from '@sschepis/tinyaleph/transport';

export class AlephMeshSync {
  private logger = new Logger('aleph-mesh');
  private unsubscribeBus?: () => void;
  private transportManager: any;
  private podName: string;

  constructor(private bus: AgentEventBus) {
    this.podName = process.env.POD_NAME || 'UnknownPod';
    this.logger.info(`Initializing AlephMeshSync for pod: ${this.podName}`);
    this.setupTransport();
    this.setupEventListeners();
  }

  private setupTransport() {
    try {
      this.transportManager = new TransportManager();
      
      // In a real P2P mesh, we would configure endpoints dynamically,
      // but here we setup a placeholder WebSocket transport config.
      const wsTransport = new WebSocketTransport({
        url: process.env.ALEPH_MESH_URL || 'ws://localhost:8080/mesh',
        maxReconnectAttempts: 10
      });

      this.transportManager.addTransport('ws', wsTransport);
      this.transportManager.setFallbackOrder(['ws']);
      
      this.transportManager.on('message', (msg: any) => {
        this.handleIncomingMeshMessage(msg);
      });

      this.transportManager.connect().catch((err: Error) => {
        this.logger.warn(`Failed to connect to Aleph mesh: ${err.message}`);
      });
    } catch (e) {
      this.logger.error('Failed to initialize Aleph TransportManager', e);
    }
  }

  private setupEventListeners() {
    // Listen to oboto-agent state changes
    this.unsubscribeBus = this.bus.on('state_updated', (event) => {
      this.broadcastStateUpdate(event.payload);
    });

    // Also listen for task completions to share "Realizations"
    this.bus.on('turn_complete', (event) => {
      this.broadcastRealization(event.payload);
    });
  }

  private broadcastStateUpdate(payload: any) {
    if (this.transportManager?.getPrimary()) {
      this.transportManager.send({
        type: 'STATE_SYNC',
        pod: this.podName,
        payload,
        timestamp: Date.now()
      }).catch((e: Error) => this.logger.error('Mesh broadcast failed', e));
    }
  }

  private broadcastRealization(payload: any) {
    if (this.transportManager?.getPrimary()) {
      this.transportManager.send({
        type: 'FLEET_REALIZATION',
        pod: this.podName,
        payload,
        timestamp: Date.now()
      }).catch((e: Error) => this.logger.error('Mesh realization broadcast failed', e));
    }
  }

  private handleIncomingMeshMessage(msg: any) {
    if (!msg || msg.pod === this.podName) return; // Ignore own messages

    this.logger.info(`Received mesh message from ${msg.pod}: ${msg.type}`);
    
    // Passively absorb "Fleet Entropy" or realizations from other pods
    if (msg.type === 'FLEET_REALIZATION') {
      // We could inject this into the local oboto-agent session as a system realization
      this.logger.info(`Absorbing fleet realization from ${msg.pod}`);
    }
  }

  public dispose() {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
    }
    if (this.transportManager) {
      this.transportManager.disconnect();
    }
  }
}
