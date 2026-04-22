export function planProposalQuestion(plan: string): string {
  return `I have formulated a plan. Do you want to accept it and transition to 'act' mode?\n\n**Proposed Plan:**\n${plan}`;
}

export const PLAN_PROPOSAL_CHOICES = [
  'Accept Plan & Transition to Act',
  'Deny / Revise Plan',
] as const;

export const PLAN_ACCEPTED_AUTO =
  "Plan approved (auto-accept mode). Mode transitioned to 'act'. File changes will be applied automatically. Proceed with executing the plan.";

export const PLAN_ACCEPTED_MANUAL =
  "Plan approved (review-each mode). Mode transitioned to 'act'. Each file change will require user approval. Proceed with executing the plan.";

export const PLAN_ACCEPTED =
  "Plan accepted. Mode transitioned to 'act'. You may now proceed with executing the plan using appropriate tools.";

export const PLAN_DENIED =
  'Plan denied or cancelled. Please ask the user for clarification or revise your plan.';

export function planDenied(result: string): string {
  return `Plan denied or cancelled. Result: ${result}\n\nPlease ask the user for clarification or revise your plan.`;
}
