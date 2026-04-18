import type { WebviewToExtMessage, ExtToWebviewMessage } from '../../src/shared/message-types';

interface VsCodeApi {
  postMessage(message: WebviewToExtMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// acquireVsCodeApi is provided by VS Code in the webview context.
// In dev mode (standalone browser), we fall back to a mock.
let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (api) return api;

  if (typeof acquireVsCodeApi === 'function') {
    api = acquireVsCodeApi() as VsCodeApi;
  } else {
    // Mock for standalone development
    api = {
      postMessage: (msg: WebviewToExtMessage) => {
        console.log('[mock vscode.postMessage]', msg);
      },
      getState: () => undefined,
      setState: () => {},
    };
  }

  return api;
}

export function postMessage(message: WebviewToExtMessage): void {
  getVsCodeApi().postMessage(message);
}

export function onMessage(handler: (message: ExtToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent<ExtToWebviewMessage>) => {
    handler(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

declare function acquireVsCodeApi(): unknown;
