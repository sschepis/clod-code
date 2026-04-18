import { useEffect, useCallback } from 'react';
import { postMessage, onMessage } from '../vscode-api';
import type {
  ExtToWebviewMessage, Attachment,
  ObjectCategory, ObjectActionKind,
} from '../../../src/shared/message-types';

/**
 * Hook that manages bidirectional communication with the extension host.
 * Sends a 'ready' message on mount and forwards all incoming messages
 * to the provided handler.
 *
 * All outgoing actions take an optional agentId; undefined defaults to
 * the foreground agent at the extension-host side.
 */
export function useVsCode(onExtMessage: (msg: ExtToWebviewMessage) => void) {
  useEffect(() => {
    const panelAgentId = (window as any).__CLODCODE_PANEL_AGENT_ID__ as string | undefined;
    postMessage({ type: 'ready', panelAgentId });
    return onMessage(onExtMessage);
  }, [onExtMessage]);

  const submit = useCallback(
    (text: string, attachments: Attachment[], mode: 'act' | 'plan', agentId?: string) => {
      postMessage({ type: 'submit', agentId, text, attachments, mode });
    },
    [],
  );

  const interrupt = useCallback((agentId?: string) => {
    postMessage({ type: 'interrupt', agentId });
  }, []);

  const clearSession = useCallback(() => {
    postMessage({ type: 'clear_session' });
  }, []);

  const changeModel = useCallback((provider: string, model: string) => {
    postMessage({ type: 'change_model', provider, model });
  }, []);

  const revert = useCallback((eventId: string, agentId?: string) => {
    postMessage({ type: 'revert', agentId, eventId });
  }, []);

  const respondPermission = useCallback(
    (eventId: string, allowed: boolean, remember: boolean, agentId?: string) => {
      postMessage({ type: 'permission_response', agentId, eventId, allowed, remember });
    },
    [],
  );

  const respondQuestion = useCallback(
    (
      promptId: string,
      response: { cancelled?: boolean; answerIndex?: number; answerText?: string },
      agentId?: string,
    ) => {
      postMessage({ type: 'ask_question_response', agentId, promptId, ...response });
    },
    [],
  );

  const respondSecret = useCallback(
    (
      promptId: string,
      response: { cancelled?: boolean; value?: string; saveToFile?: boolean },
      agentId?: string,
    ) => {
      postMessage({ type: 'ask_secret_response', agentId, promptId, ...response });
    },
    [],
  );

  const respondPeerDispatch = useCallback(
    (promptId: string, approved: boolean, agentId?: string) => {
      postMessage({ type: 'peer_dispatch_response', agentId, promptId, approved });
    },
    [],
  );

  const sendSlashCommand = useCallback((command: string, args: string, agentId?: string) => {
    postMessage({ type: 'slash_command', agentId, command, args });
  }, []);

  const focusAgent = useCallback((agentId: string) => {
    postMessage({ type: 'focus_agent', agentId });
  }, []);

  const cancelAgent = useCallback((agentId: string) => {
    postMessage({ type: 'cancel_agent', agentId });
  }, []);

  const requestObjectsSync = useCallback(() => {
    postMessage({ type: 'request_objects_sync' });
  }, []);

  const objectAction = useCallback(
    (category: ObjectCategory, action: ObjectActionKind, id: string, agentId?: string) => {
      postMessage({ type: 'object_action', category, action, id, agentId });
    },
    [],
  );

  return {
    submit,
    interrupt,
    clearSession,
    changeModel,
    revert,
    respondPermission,
    respondQuestion,
    respondSecret,
    respondPeerDispatch,
    sendSlashCommand,
    focusAgent,
    cancelAgent,
    requestObjectsSync,
    objectAction,
  };
}
