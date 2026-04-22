import * as vscode from 'vscode';
import type { ProjectManager } from '../projects/project-manager';
import { scanWorkspaceConventions } from '../projects/convention-scanner';
import type { PlanStep, ReviewFinding, ProjectConvention, ProjectType } from '../projects/project-types';

export interface ProjectToolDeps {
  manager: ProjectManager;
}

function parseJsonArg<T>(value: unknown): T | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return null;
}

// ── project/init ─────────────────────────────────────────────────────

export function createProjectInitHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = String(kwargs.name || '').trim();
    const type = String(kwargs.type || '').trim() as ProjectType;
    const description = String(kwargs.description || '').trim();
    const scanConventions = kwargs.scan_conventions !== false;

    if (!name) return '[ERROR] Missing required argument: name';
    if (!['new-build', 'existing-codebase', 'ad-hoc'].includes(type)) {
      return '[ERROR] Invalid type. Must be one of: new-build, existing-codebase, ad-hoc';
    }

    let conventions: ProjectConvention[] = [];
    let techStack: string[] | undefined;
    let entryPoints: string[] | undefined;

    if (type === 'existing-codebase' && scanConventions) {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) {
        const scan = scanWorkspaceConventions(root);
        conventions = scan.conventions;
        techStack = scan.techStack.length > 0 ? scan.techStack : undefined;
        entryPoints = scan.entryPoints.length > 0 ? scan.entryPoints : undefined;
      }
    }

    const result = deps.manager.create({
      name,
      type,
      description: description || `${type} project: ${name}`,
      conventions,
      techStack,
      entryPoints,
    });

    if (!result.ok) return `[ERROR] ${result.error}`;

    const lines = [
      `[SUCCESS] Project "${name}" initialized at ${result.path}`,
      `Type: ${type} | Status: active | ID: ${result.project.id}`,
    ];

    if (conventions.length > 0) {
      lines.push('', `Detected ${conventions.length} convention(s):`);
      for (const c of conventions) {
        lines.push(`  - [${c.category}] ${c.rule}`);
      }
    }

    if (techStack && techStack.length > 0) {
      lines.push(`Tech stack: ${techStack.join(', ')}`);
    }

    return lines.join('\n');
  };
}

// ── project/list ─────────────────────────────────────────────────────

export function createProjectListHandler(deps: ProjectToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const projects = deps.manager.list();
    if (projects.length === 0) return 'No projects found. Use project/init to create one.';

    const lines = projects.map(
      (p) => `- [${p.status}] ${p.name} (${p.type}) — id: ${p.id}`,
    );
    return lines.join('\n');
  };
}

// ── project/get ──────────────────────────────────────────────────────

export function createProjectGetHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const id = String(kwargs.id || '').trim();
    if (!id) return '[ERROR] Missing required argument: id';

    return deps.manager.getDashboard(id);
  };
}

// ── project/update ───────────────────────────────────────────────────

export function createProjectUpdateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const id = String(kwargs.id || '').trim();
    if (!id) return '[ERROR] Missing required argument: id';

    const patch: Record<string, unknown> = {};
    if (kwargs.name) patch.name = String(kwargs.name).trim();
    if (kwargs.description) patch.description = String(kwargs.description).trim();
    if (kwargs.status) patch.status = String(kwargs.status).trim();
    if (kwargs.conventions) {
      const parsed = parseJsonArg<ProjectConvention[]>(kwargs.conventions);
      if (parsed) patch.conventions = parsed;
    }
    if (kwargs.guidelines) {
      const parsed = parseJsonArg<string[]>(kwargs.guidelines);
      if (parsed) patch.guidelines = parsed;
    }

    if (Object.keys(patch).length === 0) return '[ERROR] No fields to update. Provide at least one of: name, description, status, conventions, guidelines';

    const result = deps.manager.update(id, patch as any);
    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Project "${id}" updated.`;
  };
}

// ── project/plan ─────────────────────────────────────────────────────

export function createProjectPlanCreateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    const title = String(kwargs.title || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';
    if (!title) return '[ERROR] Missing required argument: title';

    const steps = parseJsonArg<PlanStep[]>(kwargs.steps);
    const result = deps.manager.createPlan(projectId, {
      title,
      objective: kwargs.objective ? String(kwargs.objective).trim() : undefined,
      scope: kwargs.scope ? String(kwargs.scope).trim() : undefined,
      steps: steps ?? undefined,
      testStrategy: kwargs.test_strategy ? String(kwargs.test_strategy).trim() : undefined,
      markdownBody: kwargs.markdown ? String(kwargs.markdown) : undefined,
    });

    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Plan "${result.plan.title}" created with id "${result.plan.id}" (status: draft). Use plan/propose to present it to the user for approval, then project/plan-update to change status.`;
  };
}

// ── project/plan-update ──────────────────────────────────────────────

export function createProjectPlanUpdateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    const planId = String(kwargs.plan_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';
    if (!planId) return '[ERROR] Missing required argument: plan_id';

    const patch: Record<string, unknown> = {};
    if (kwargs.status) patch.status = String(kwargs.status).trim();
    if (kwargs.title) patch.title = String(kwargs.title).trim();
    if (kwargs.objective) patch.objective = String(kwargs.objective).trim();
    if (kwargs.scope) patch.scope = String(kwargs.scope).trim();
    if (kwargs.test_strategy) patch.testStrategy = String(kwargs.test_strategy).trim();
    if (kwargs.markdown) patch.markdownBody = String(kwargs.markdown);
    if (kwargs.steps) {
      const parsed = parseJsonArg<PlanStep[]>(kwargs.steps);
      if (parsed) patch.steps = parsed;
    }

    if (Object.keys(patch).length === 0) return '[ERROR] No fields to update.';

    const result = deps.manager.updatePlan(projectId, planId, patch as any);
    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Plan "${planId}" updated (status: ${result.plan.status}).`;
  };
}

// ── project/plan-list ────────────────────────────────────────────────

export function createProjectPlanListHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';

    let plans = deps.manager.listPlans(projectId);
    const statusFilter = kwargs.status ? String(kwargs.status).trim() : undefined;
    if (statusFilter) {
      plans = plans.filter((p) => p.status === statusFilter);
    }

    if (plans.length === 0) return 'No plans found.';

    const lines = plans.map((p) => {
      const done = p.steps.filter((s) => s.completed).length;
      const total = p.steps.length;
      return `- [${p.status}] ${p.title} (id: ${p.id}) — ${done}/${total} steps`;
    });
    return lines.join('\n');
  };
}

// ── project/task ─────────────────────────────────────────────────────

export function createProjectTaskCreateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    const description = String(kwargs.description || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';
    if (!description) return '[ERROR] Missing required argument: description';

    const result = deps.manager.createTask(projectId, {
      description,
      planId: kwargs.plan_id ? String(kwargs.plan_id).trim() : undefined,
      planStepId: kwargs.plan_step_id ? String(kwargs.plan_step_id).trim() : undefined,
      status: kwargs.status ? (String(kwargs.status).trim() as any) : undefined,
      assignee: kwargs.assignee ? String(kwargs.assignee).trim() : undefined,
      result: kwargs.result ? String(kwargs.result).trim() : undefined,
      notes: kwargs.notes ? String(kwargs.notes).trim() : undefined,
    });

    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Task created: "${description}" (id: ${result.task.id}, status: ${result.task.status})`;
  };
}

// ── project/task-update ──────────────────────────────────────────────

export function createProjectTaskUpdateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    const taskId = String(kwargs.task_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';
    if (!taskId) return '[ERROR] Missing required argument: task_id';

    const patch: Record<string, unknown> = {};
    if (kwargs.status) patch.status = String(kwargs.status).trim();
    if (kwargs.result) patch.result = String(kwargs.result).trim();
    if (kwargs.notes) patch.notes = String(kwargs.notes).trim();
    if (kwargs.assignee) patch.assignee = String(kwargs.assignee).trim();

    if (Object.keys(patch).length === 0) return '[ERROR] No fields to update.';

    const result = deps.manager.updateTask(projectId, taskId, patch as any);
    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Task "${taskId}" updated (status: ${result.task.status}).`;
  };
}

// ── project/task-list ────────────────────────────────────────────────

export function createProjectTaskListHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';

    const planId = kwargs.plan_id ? String(kwargs.plan_id).trim() : undefined;
    let tasks = deps.manager.listTasks(projectId, planId);

    const statusFilter = kwargs.status ? String(kwargs.status).trim() : undefined;
    if (statusFilter) {
      tasks = tasks.filter((t) => t.status === statusFilter);
    }

    if (tasks.length === 0) return 'No tasks found.';

    const lines = tasks.map((t) => {
      const parts = [`- [${t.status}] ${t.description} (id: ${t.id})`];
      if (t.result) parts.push(`  Result: ${t.result}`);
      if (t.notes) parts.push(`  Notes: ${t.notes}`);
      return parts.join('\n');
    });
    return lines.join('\n');
  };
}

// ── project/review ───────────────────────────────────────────────────

export function createProjectReviewCreateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    const title = String(kwargs.title || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';
    if (!title) return '[ERROR] Missing required argument: title';

    const reviewedFiles = parseJsonArg<string[]>(kwargs.reviewed_files);
    const findings = parseJsonArg<ReviewFinding[]>(kwargs.findings);

    const result = deps.manager.createReview(projectId, {
      title,
      planId: kwargs.plan_id ? String(kwargs.plan_id).trim() : undefined,
      reviewedFiles: reviewedFiles ?? undefined,
      findings: findings ?? undefined,
      summary: kwargs.summary ? String(kwargs.summary).trim() : undefined,
      status: kwargs.status ? (String(kwargs.status).trim() as any) : undefined,
    });

    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Review "${title}" created (id: ${result.review.id}, status: ${result.review.status}, findings: ${result.review.findings.length})`;
  };
}

// ── project/review-update ────────────────────────────────────────────

export function createProjectReviewUpdateHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    const reviewId = String(kwargs.review_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';
    if (!reviewId) return '[ERROR] Missing required argument: review_id';

    const patch: Record<string, unknown> = {};
    if (kwargs.status) patch.status = String(kwargs.status).trim();
    if (kwargs.summary) patch.summary = String(kwargs.summary).trim();
    if (kwargs.findings) {
      const parsed = parseJsonArg<ReviewFinding[]>(kwargs.findings);
      if (parsed) patch.findings = parsed;
    }

    if (Object.keys(patch).length === 0) return '[ERROR] No fields to update.';

    const result = deps.manager.updateReview(projectId, reviewId, patch as any);
    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Review "${reviewId}" updated (status: ${result.review.status}).`;
  };
}

// ── project/status ───────────────────────────────────────────────────

export function createProjectStatusHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';

    return deps.manager.getDashboard(projectId);
  };
}

// ── project/archive ──────────────────────────────────────────────────

export function createProjectArchiveHandler(deps: ProjectToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const projectId = String(kwargs.project_id || '').trim();
    if (!projectId) return '[ERROR] Missing required argument: project_id';

    const result = deps.manager.archive(projectId);
    if (!result.ok) return `[ERROR] ${result.error}`;
    return `[SUCCESS] Project "${projectId}" archived. All plans, tasks, and reviews moved to archive/.`;
  };
}

// ── Aggregator ───────────────────────────────────────────────────────

export function createProjectHandlers(deps: ProjectToolDeps) {
  return {
    init: createProjectInitHandler(deps),
    list: createProjectListHandler(deps),
    get: createProjectGetHandler(deps),
    update: createProjectUpdateHandler(deps),
    planCreate: createProjectPlanCreateHandler(deps),
    planUpdate: createProjectPlanUpdateHandler(deps),
    planList: createProjectPlanListHandler(deps),
    taskCreate: createProjectTaskCreateHandler(deps),
    taskUpdate: createProjectTaskUpdateHandler(deps),
    taskList: createProjectTaskListHandler(deps),
    reviewCreate: createProjectReviewCreateHandler(deps),
    reviewUpdate: createProjectReviewUpdateHandler(deps),
    status: createProjectStatusHandler(deps),
    archive: createProjectArchiveHandler(deps),
  };
}
