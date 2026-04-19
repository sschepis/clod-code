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
  EXPLAIN_CODE: 'clodcode.explainCode',
  REFACTOR_CODE: 'clodcode.refactorCode',
  WRITE_TESTS: 'clodcode.writeTests',
  // Explorer context menu commands
  EXPLORER_OPEN_FILE: 'clodcode.explorer.openFile',
  EXPLORER_DELETE_FILE: 'clodcode.explorer.deleteFile',
  EXPLORER_REVEAL_IN_FINDER: 'clodcode.explorer.revealInFinder',
  EXPLORER_COPY_PATH: 'clodcode.explorer.copyPath',
  EXPLORER_COPY_RELATIVE_PATH: 'clodcode.explorer.copyRelativePath',
  EXPLORER_CANCEL_TASK: 'clodcode.explorer.cancelTask',
  EXPLORER_COPY_TASK_RESULT: 'clodcode.explorer.copyTaskResult',
  EXPLORER_RERUN_TASK: 'clodcode.explorer.rerunTask',
  EXPLORER_FOCUS_TASK: 'clodcode.explorer.focusTask',
} as const;

export const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_AI_API_KEY',
  'vertex-gemini': 'GOOGLE_APPLICATION_CREDENTIALS',
  'vertex-anthropic': 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  'azure-openai': 'AZURE_OPENAI_API_KEY',
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
