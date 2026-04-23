// Stub — AlephNet API was removed. These no-op functions satisfy
// explorer-provider imports until the tree view is fully migrated.

export async function getIdentity(): Promise<{ name?: string; nodeId?: string } | null> {
  return null;
}

export async function getNodes(): Promise<{ name?: string; nodeId?: string; address?: string; status?: string; lastSeen?: string }[]> {
  return [];
}

export async function getLearningTopics(): Promise<{ topic: string; progress?: number }[]> {
  return [];
}

export async function getLearningStatus(): Promise<{ active: boolean; topic?: string } | null> {
  return null;
}

export async function getStatus(): Promise<{ nodeId?: string; connections?: number } | null> {
  return null;
}
