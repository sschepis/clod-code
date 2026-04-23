// Stub — AlephNet manager was removed. Returns disconnected status
// so the explorer tree shows "Not connected" gracefully.

export async function getAlephNetStatus(): Promise<{ connected: boolean; port: number }> {
  return { connected: false, port: 0 };
}
