export const WORKING_ON_PLAN = 'One moment, working on a plan…';

export const LOOKING_INTO_THAT = 'One sec, looking into that…';

export const STOPPING_WORK = "I'll stop working right away.";

export const AGENT_INITIALIZING =
  'Agent is still initializing. Please wait a moment and try again.';

export function peerDispatchQuestion(fromWindowId: string, question: string): string {
  return `[from peer ${fromWindowId.slice(0, 8)}]\n\n${question}`;
}

export function dispatchConfirmation(agentLabels: string[]): string {
  return (
    `Dispatching task to ${agentLabels.length} agent${agentLabels.length === 1 ? '' : 's'}:\n\n` +
    agentLabels.map(a => `- **${a}**`).join('\n')
  );
}
