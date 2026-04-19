export const EXTENSION_ID = 'obotovs';
export const VIEW_ID = 'obotovs.chatPanel';

export const COMMANDS = {
  NEW_SESSION: 'obotovs.newSession',
  CLEAR_SESSION: 'obotovs.clearSession',
  SWITCH_MODEL: 'obotovs.switchModel',
  ASK_ABOUT_SELECTION: 'obotovs.askAboutSelection',
  FOCUS_CHAT: 'obotovs.focusChat',
  OPEN_SETTINGS: 'obotovs.openSettings',
  SHOW_LOGS: 'obotovs.showLogs',
  OPEN_SURFACE: 'obotovs.openSurface',
  NEW_CHAT: 'obotovs.newChat',
  LIST_CHATS: 'obotovs.listChats',
  EXPLAIN_CODE: 'obotovs.explainCode',
  REFACTOR_CODE: 'obotovs.refactorCode',
  WRITE_TESTS: 'obotovs.writeTests',
  // Explorer context menu commands
  EXPLORER_OPEN_FILE: 'obotovs.explorer.openFile',
  EXPLORER_DELETE_FILE: 'obotovs.explorer.deleteFile',
  EXPLORER_REVEAL_IN_FINDER: 'obotovs.explorer.revealInFinder',
  EXPLORER_COPY_PATH: 'obotovs.explorer.copyPath',
  EXPLORER_COPY_RELATIVE_PATH: 'obotovs.explorer.copyRelativePath',
  EXPLORER_CANCEL_TASK: 'obotovs.explorer.cancelTask',
  EXPLORER_COPY_TASK_RESULT: 'obotovs.explorer.copyTaskResult',
  EXPLORER_RERUN_TASK: 'obotovs.explorer.rerunTask',
  EXPLORER_FOCUS_TASK: 'obotovs.explorer.focusTask',
} as const;

export const ENV_KEY_MAP: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_AI_API_KEY',
  'vertex-gemini': 'GOOGLE_APPLICATION_CREDENTIALS',
  'vertex-anthropic': 'GOOGLE_APPLICATION_CREDENTIALS',
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
