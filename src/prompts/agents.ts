export const SUBCONSCIOUS_OBSERVER_TASK =
  'You are the subconscious observer. Loop system/observe. Update memory and warn the foreground agent if they make a mistake.';

export function interAgentMessage(callerLabel: string, message: string): string {
  return `[Message from ${callerLabel}]: ${message}`;
}

export function interAgentSentConfirmation(targetId: string): string {
  return `[SENT] Message delivered to ${targetId}. The target agent will process it asynchronously.`;
}

export const INTER_AGENT_TIMEOUT =
  '[TIMEOUT] Target agent did not respond within 120 seconds.';

export const INTER_AGENT_SLICE_NOT_FOUND =
  '[ERROR] Target agent slice not found.';

export const INTER_AGENT_NO_TEXT_RESPONSE =
  '[INFO] Target agent processed the message but produced no text response.';
