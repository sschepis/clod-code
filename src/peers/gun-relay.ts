import * as http from 'http';
import { logger } from '../shared/logger';

export class GunRelayServer {
  private server?: http.Server;
  private gun?: any;
  private port: number = 8765;

  constructor() {}

  async start(port: number = 8765): Promise<void> {
    if (this.server) {
      logger.info(`[GunRelay] Already running on port ${this.port}`);
      return Promise.resolve();
    }
    
    this.port = port;
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('Gun Relay Node is running');
      });

      try {
        const Gun = require('gun');
        this.gun = Gun({ web: this.server });
        
        this.server.listen(this.port, () => {
          logger.info(`[GunRelay] Started on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (err) => {
          logger.error('[GunRelay] Server error', err);
          this.server = undefined;
          this.gun = undefined;
          reject(err);
        });
      } catch (err) {
        logger.error('[GunRelay] Failed to start', err);
        reject(err);
      }
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        logger.info('[GunRelay] Stopped');
        this.server = undefined;
        this.gun = undefined;
        resolve();
      });
    });
  }

  status() {
    return {
      running: !!this.server,
      port: this.port
    };
  }
}
