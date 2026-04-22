import { getSettings } from './settings';

function baseUrl(): string {
  const port = getSettings().alephnet?.port || 31337;
  return `http://localhost:${port}`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, { method: 'GET' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface AlephNetIdentity {
  nodeId: string;
  name?: string;
  publicKey?: string;
  tier?: number;
  balance?: number;
  reputation?: number;
  [key: string]: unknown;
}

export interface AlephNetNode {
  nodeId: string;
  name?: string;
  address?: string;
  status?: string;
  lastSeen?: string;
  [key: string]: unknown;
}

export interface AlephNetLearningTopic {
  topic: string;
  status?: string;
  progress?: number;
  [key: string]: unknown;
}

export interface AlephNetLearningStatus {
  active: boolean;
  topic?: string;
  progress?: number;
  [key: string]: unknown;
}

export interface AlephNetStatus {
  nodeId?: string;
  uptime?: number;
  connections?: number;
  [key: string]: unknown;
}

export async function getIdentity(): Promise<AlephNetIdentity | null> {
  return fetchJson<AlephNetIdentity>('/identity');
}

export async function getNodes(): Promise<AlephNetNode[]> {
  const data = await fetchJson<{ nodes?: AlephNetNode[]; peers?: AlephNetNode[] }>('/nodes');
  return data?.nodes ?? data?.peers ?? [];
}

export async function getLearningTopics(): Promise<AlephNetLearningTopic[]> {
  const data = await fetchJson<{ topics?: AlephNetLearningTopic[] }>('/learning/topics');
  return data?.topics ?? [];
}

export async function getLearningStatus(): Promise<AlephNetLearningStatus | null> {
  return fetchJson<AlephNetLearningStatus>('/learning/status');
}

export async function getStatus(): Promise<AlephNetStatus | null> {
  return fetchJson<AlephNetStatus>('/status');
}

export async function getIntrospect(): Promise<Record<string, unknown> | null> {
  return fetchJson<Record<string, unknown>>('/introspect');
}
