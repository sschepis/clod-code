import { Worker } from 'worker_threads';
import { logger } from '../shared/logger';
import { scanRoutes, type RouteEntry } from './route-loader';

export interface RouteServerOptions {
  workspaceRoot: string;
  port: number;
  /** URL base path prefix, defaults to `/api`. */
  apiPrefix?: string;
}

export class RouteServer {
  private worker?: Worker;
  private readonly apiPrefix: string;

  constructor(private readonly opts: RouteServerOptions) {
    this.apiPrefix = (opts.apiPrefix ?? '/api').replace(/\/+$/, '');
  }

  get port(): number { return this.opts.port; }
  get baseUrl(): string { return `http://127.0.0.1:${this.opts.port}${this.apiPrefix}`; }

  /** Re-scan the routes directory. Call after any file-system change. */
  rescan(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'rescan' });
    }
  }

  list(): Array<{ urlPath: string; file: string }> {
    // We can't synchronously ask the worker for the list.
    // As a workaround, we just scan it synchronously here too for the UI list.
    return scanRoutes(this.opts.workspaceRoot).map((e) => ({ urlPath: e.urlPath, file: e.file }));
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(__filename, {
        workerData: {
          type: 'route-worker',
          workspaceRoot: this.opts.workspaceRoot,
          port: this.opts.port,
          apiPrefix: this.apiPrefix
        }
      });

      this.worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          logger.info(`[routes] listening on ${this.baseUrl} (Worker Thread)`);
          resolve();
        } else if (msg.type === 'error') {
          logger.error('[routes] worker server error', msg.error);
          reject(new Error(msg.error));
        }
      });

      this.worker.on('error', (err) => {
        logger.error('[routes] worker crashed', err);
        // If it crashes after starting, we might want to automatically restart it.
        // For now, we just log it.
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          logger.warn(`[routes] worker stopped with exit code ${code}`);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    return new Promise((resolve) => {
      this.worker!.on('exit', () => resolve());
      this.worker!.postMessage({ type: 'stop' });
      this.worker = undefined;
      logger.info('[routes] stopped');
    });
  }
}
