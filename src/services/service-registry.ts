export interface ServiceAdapter {
  id: string;
  displayName: string;
  description: string;
  envKeys: string[];
  category: 'api' | 'storage' | 'messaging' | 'search' | 'compute';
  checkHealth?: () => Promise<boolean>;
}

export interface ServiceStatus {
  configured: boolean;
  missingKeys: string[];
  healthy?: boolean;
}

const BUILT_IN: ServiceAdapter[] = [
  { id: 'github', displayName: 'GitHub', description: 'GitHub API access', envKeys: ['GITHUB_TOKEN'], category: 'api' },
  { id: 'slack', displayName: 'Slack', description: 'Slack messaging', envKeys: ['SLACK_BOT_TOKEN'], category: 'messaging' },
  { id: 'openai', displayName: 'OpenAI', description: 'OpenAI API', envKeys: ['OPENAI_API_KEY'], category: 'compute' },
  { id: 'anthropic', displayName: 'Anthropic', description: 'Anthropic API', envKeys: ['ANTHROPIC_API_KEY'], category: 'compute' },
  { id: 'brave-search', displayName: 'Brave Search', description: 'Brave web search API', envKeys: ['BRAVE_SEARCH_API_KEY'], category: 'search' },
  { id: 'elevenlabs', displayName: 'ElevenLabs', description: 'ElevenLabs text-to-speech', envKeys: ['ELEVENLABS_API_KEY'], category: 'compute' },
  { id: 'google-ai', displayName: 'Google AI', description: 'Google AI / Gemini API', envKeys: ['GOOGLE_AI_API_KEY'], category: 'compute' },
];

export class ServiceRegistry {
  private adapters = new Map<string, ServiceAdapter>();

  constructor() {
    for (const a of BUILT_IN) this.adapters.set(a.id, a);
  }

  register(adapter: ServiceAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(id: string): void {
    this.adapters.delete(id);
  }

  list(): ServiceAdapter[] {
    return [...this.adapters.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): ServiceAdapter | undefined {
    return this.adapters.get(id);
  }

  getStatus(id: string): ServiceStatus {
    const adapter = this.adapters.get(id);
    if (!adapter) return { configured: false, missingKeys: [] };
    const missing = adapter.envKeys.filter(k => !process.env[k]);
    return { configured: missing.length === 0, missingKeys: missing };
  }

  async checkHealth(id: string): Promise<boolean> {
    const adapter = this.adapters.get(id);
    if (!adapter) return false;
    const status = this.getStatus(id);
    if (!status.configured) return false;
    if (!adapter.checkHealth) return true;
    try {
      return await adapter.checkHealth();
    } catch {
      return false;
    }
  }
}
