import type { AgentToolDeps } from './agent-deps';

interface EventBuffer {
  events: any[];
  waiters: ((data: any) => void)[];
}

const buffers = new Map<string, EventBuffer>();

export function pushSubconsciousEvent(targetId: string, event: any) {
  let buf = buffers.get(targetId);
  if (!buf) {
    buf = { events: [], waiters: [] };
    buffers.set(targetId, buf);
  }
  
  if (buf.waiters.length > 0) {
    const resolve = buf.waiters.shift()!;
    resolve([event]);
  } else {
    buf.events.push(event);
  }
}

export function createSystemObserveHandler(deps: AgentToolDeps) {
  return async (): Promise<string> => {
    const callerId = deps.callerId();
    let buf = buffers.get(callerId);
    if (!buf) {
      buf = { events: [], waiters: [] };
      buffers.set(callerId, buf);
    }

    if (buf.events.length > 0) {
      const evts = [...buf.events];
      buf.events = [];
      return JSON.stringify(evts, null, 2);
    }

    return new Promise((resolve) => {
      // Wait up to 60 seconds
      const timer = setTimeout(() => {
        const idx = buf!.waiters.indexOf(wrapper);
        if (idx !== -1) buf!.waiters.splice(idx, 1);
        resolve('[] (Timeout waiting for events)');
      }, 60000);

      const wrapper = (data: any) => {
        clearTimeout(timer);
        resolve(JSON.stringify(data, null, 2));
      };

      buf!.waiters.push(wrapper);
    });
  };
}
