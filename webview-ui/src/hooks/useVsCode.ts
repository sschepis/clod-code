import { useEffect, useCallback } from 'react';
import { postMessage, onMessage } from '../vscode-api';
import type {
  ExtToWebviewMessage, Attachment, RoutingMode,
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
    const panelAgentId = (window as any).__OBOTOVS_PANEL_AGENT_ID__ as string | undefined;
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

  const changeModel = useCallback((provider: string, model: string, role?: 'triage' | 'executor') => {
    postMessage({ type: 'change_model', provider, model, role });
  }, []);

  const changeRoutingMode = useCallback((mode: RoutingMode, agentId?: string) => {
    postMessage({ type: 'change_routing_mode', mode, agentId });
  }, []);

  const revert = useCallback((eventId: string, agentId?: string) => {
    postMessage({ type: 'revert', agentId, eventId });
  }, []);

  const deleteEvent = useCallback((eventId: string, agentId?: string) => {
    postMessage({ type: 'delete_event', agentId, eventId });
  }, []);

  const editAndResubmit = useCallback((eventId: string, text: string, agentId?: string) => {
    postMessage({ type: 'edit_and_resubmit', agentId, eventId, text });
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

  const respondPlanApproval = useCallback(
    (promptId: string, response: { denied?: boolean; approvalMode?: 'auto' | 'manual' }, agentId?: string) => {
      postMessage({ type: 'plan_approval_response', agentId, promptId, ...response });
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
    changeRoutingMode,
    revert,
    deleteEvent,
    editAndResubmit,
    respondPermission,
    respondQuestion,
    respondSecret,
    respondPeerDispatch,
    respondPlanApproval,
    sendSlashCommand,
    focusAgent,
    cancelAgent,
    requestObjectsSync,
    objectAction,
  };
}
