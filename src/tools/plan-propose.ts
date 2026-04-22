import * as path from 'path';
import * as crypto from 'crypto';
import type { AgentToolDeps } from './agent-deps';
import type { ExtToWebviewMessage, PlanApprovalMode } from '../shared/message-types';
import type { UserPromptBridge } from '../agent/user-prompt-bridge';
import { PLAN_ACCEPTED_AUTO, PLAN_ACCEPTED_MANUAL, PLAN_DENIED } from '../prompts';

export interface PlanProposeDeps {
  bridge: UserPromptBridge;
  post: (msg: ExtToWebviewMessage) => void;
  appendEvent: (event: any) => void;
  patchEvent: (promptId: string, patch: Record<string, unknown>) => void;
  getWorkspaceRoot: () => string | undefined;
  openMarkdownPreview: (filePath: string) => Promise<void>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  mkdirp: (dirPath: string) => Promise<void>;
  setApprovalMode: (mode: PlanApprovalMode) => void;
}

function extractSummary(plan: string): string {
  const lines = plan.split('\n').filter(l => l.trim());
  const heading = lines.find(l => /^#+\s/.test(l));
  if (heading) return heading.replace(/^#+\s*/, '');
  return lines[0]?.slice(0, 120) ?? 'Implementation plan';
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function createPlanProposeHandler(deps: PlanProposeDeps, agentDeps?: AgentToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const plan = String(kwargs.plan || '').trim();
    if (!plan) return '[ERROR] Missing required argument: plan';

    if (!agentDeps) {
      return '[ERROR] Agent dependencies are not available. Cannot transition mode.';
    }

    const root = deps.getWorkspaceRoot();
    if (!root) return '[ERROR] No workspace folder open.';

    const plansDir = path.join(root, '.obotovs', 'plans');
    await deps.mkdirp(plansDir);
    const slug = crypto.randomBytes(3).toString('hex');
    const date = new Date().toISOString().slice(0, 10);
    const filename = `plan-${date}-${slug}.md`;
    const filePath = path.join(plansDir, filename);
    await deps.writeFile(filePath, plan);

    await deps.openMarkdownPreview(filePath);

    const planSummary = extractSummary(plan);
    const promptId = deps.bridge.nextId('plan');
    const eventId = `plan-approval-${promptId}`;

    deps.appendEvent({
      id: eventId,
      role: 'plan_approval',
      promptId,
      planSummary,
      planFilePath: filePath,
      status: 'pending',
      timestamp: now(),
    });

    deps.post({ type: 'plan_approval_request', promptId, planSummary, planFilePath: filePath });

    const result = await deps.bridge.registerPlanApproval(promptId);

    if (result.denied) {
      deps.patchEvent(promptId, { status: 'denied' });
      deps.post({ type: 'plan_approval_resolved', promptId, status: 'denied' });
      return PLAN_DENIED;
    }

    const mode: PlanApprovalMode = result.approvalMode ?? 'manual';
    deps.patchEvent(promptId, { status: 'approved', approvalMode: mode });
    deps.post({ type: 'plan_approval_resolved', promptId, status: 'approved', approvalMode: mode });
    deps.setApprovalMode(mode);

    const agentId = agentDeps.callerId();
    const bridge = agentDeps.manager.getBridge();
    bridge.setMode(agentId, 'act');

    return mode === 'auto' ? PLAN_ACCEPTED_AUTO : PLAN_ACCEPTED_MANUAL;
  };
}
