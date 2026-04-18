export const EXTENSION_ID = 'clodcode';
export const VIEW_ID = 'clodcode.chatPanel';

export const COMMANDS = {
  NEW_SESSION: 'clodcode.newSession',
  CLEAR_SESSION: 'clodcode.clearSession',
  SWITCH_MODEL: 'clodcode.switchModel',
  ASK_ABOUT_SELECTION: 'clodcode.askAboutSelection',
  FOCUS_CHAT: 'clodcode.focusChat',
  OPEN_SETTINGS: 'clodcode.openSettings',
  SHOW_LOGS: 'clodcode.showLogs',
  OPEN_SURFACE: 'clodcode.openSurface',
  NEW_CHAT: 'clodcode.newChat',
  LIST_CHATS: 'clodcode.listChats',
} as const;

export const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_AI_API_KEY',
  'vertex-gemini': 'GOOGLE_APPLICATION_CREDENTIALS',
  'vertex-anthropic': 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  ollama: '',
  lmstudio: '',
};

export const DEFAULT_LOCAL_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

export const SESSION_AUTO_SAVE_DEBOUNCE_MS = 2000;
export const MAX_TOOL_OUTPUT_LENGTH = 8000;
export const MAX_ATTACHMENT_TEXT_LENGTH = 500;
