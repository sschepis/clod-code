import type { AgentToolDeps } from './agent-deps';
import type { AskDeps } from './user-ask';
import { createAskHandler } from './user-ask';

export function createPlanProposeHandler(askDeps: AskDeps, agentDeps?: AgentToolDeps) {
  const askHandler = createAskHandler(askDeps);

  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const plan = String(kwargs.plan || '').trim();
    if (!plan) return '[ERROR] Missing required argument: plan';

    if (!agentDeps) {
      return '[ERROR] Agent dependencies are not available. Cannot transition mode.';
    }

    const question = `I have formulated a plan. Do you want to accept it and transition to 'act' mode?\n\n**Proposed Plan:**\n${plan}`;

    const result = await askHandler({
      question,
      choices: ['Accept Plan & Transition to Act', 'Deny / Revise Plan'],
      default: 0,
    });

    if (result.includes('User chose option 0')) {
      const agentId = agentDeps.callerId();
      const bridge = agentDeps.manager.getBridge();
      bridge.setMode(agentId, 'act');
      return `Plan accepted. Mode transitioned to 'act'. You may now proceed with executing the plan using appropriate tools.`;
    } else {
      return `Plan denied or cancelled. Result: ${result}\n\nPlease ask the user for clarification or revise your plan.`;
    }
  };
}
