export interface ChatTitleDeps {
  setTitle: (title: string) => void;
}

export function createChatSetTitleHandler(deps: ChatTitleDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const title = String(kwargs.title || '').trim();
    if (!title) return '[ERROR] Missing required argument: title';
    if (title.length > 100) return '[ERROR] Title must be 100 characters or fewer';

    deps.setTitle(title);
    return `Chat title set to: "${title}"`;
  };
}

export function createChatSetNameHandler(deps: ChatTitleDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    if (!name) return '[ERROR] Missing required argument: name';
    if (name.length > 50) return '[ERROR] Name must be 50 characters or fewer';

    deps.setTitle(name);
    return `Agent name set to: "${name}"`;
  };
}
