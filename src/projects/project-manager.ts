import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../shared/logger';
import { scanWorkspaceConventions } from './convention-scanner';
import type {
  ProjectMeta,
  ProjectType,
  ProjectConvention,
  Plan,
  PlanStep,
  PlanStatus,
  Task,
  TaskStatus,
  TaskList,
  Review,
  ReviewFinding,
  ReviewStatus,
} from './project-types';

export interface ProjectManagerOptions {
  onProjectChanged?: () => void;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function projectsBaseDir(root: string): string {
  return path.join(root, '.obotovs', 'projects');
}

export class ProjectManager {
  private projects = new Map<string, ProjectMeta>();
  private watcher?: vscode.FileSystemWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private readonly onProjectChanged?: () => void;

  constructor(opts: ProjectManagerOptions) {
    this.onProjectChanged = opts.onProjectChanged;
    this.reload();
    this.installWatcher();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
  }

  // ── Project CRUD ─────────────────────────────────────────────────────

  list(): ProjectMeta[] {
    return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ProjectMeta | undefined {
    return this.projects.get(id);
  }

  getActive(): ProjectMeta | undefined {
    for (const p of this.projects.values()) {
      if (p.status === 'active') return p;
    }
    return undefined;
  }

  create(params: {
    name: string;
    type: ProjectType;
    description: string;
    conventions?: ProjectConvention[];
    guidelines?: string[];
    techStack?: string[];
    entryPoints?: string[];
  }): { ok: true; project: ProjectMeta; path: string } | { ok: false; error: string } {
    const root = workspaceRoot();
    if (!root) return { ok: false, error: 'No workspace folder open.' };

    const id = this.slugify(params.name);
    if (this.projects.has(id)) return { ok: false, error: `Project "${id}" already exists.` };

    const now = new Date().toISOString();
    const project: ProjectMeta = {
      id,
      name: params.name,
      type: params.type,
      status: 'active',
      description: params.description,
      createdAt: now,
      updatedAt: now,
      conventions: params.conventions ?? [],
      guidelines: params.guidelines ?? [],
      techStack: params.techStack,
      entryPoints: params.entryPoints,
    };

    const dir = this.projectDir(id);
    try {
      fs.mkdirSync(path.join(dir, 'plans'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'reviews'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
      this.writeJson(this.projectFile(id), project);
    } catch (err) {
      return { ok: false, error: `Failed to create project directory: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.projects.set(id, project);
    this.notifyChanged();
    return { ok: true, project, path: dir };
  }

  ensureProject(): ProjectMeta | undefined {
    const active = this.getActive();
    if (active) return active;

    const root = workspaceRoot();
    if (!root) return undefined;

    const scan = scanWorkspaceConventions(root);
    const name = path.basename(root);
    const hasPackageJson = fs.existsSync(path.join(root, 'package.json'));
    const type: ProjectType = hasPackageJson ? 'existing-codebase' : 'ad-hoc';

    const result = this.create({
      name,
      type,
      description: `Auto-scaffolded project for ${name}`,
      conventions: scan.conventions,
      techStack: scan.techStack,
      entryPoints: scan.entryPoints,
    });

    if (result.ok) {
      logger.info(`ProjectManager: auto-scaffolded project "${name}" at ${result.path}`);
      return result.project;
    }

    logger.warn(`ProjectManager: failed to auto-scaffold project: ${result.error}`);
    return undefined;
  }

  update(
    id: string,
    patch: Partial<Omit<ProjectMeta, 'id' | 'createdAt'>>,
  ): { ok: true; project: ProjectMeta } | { ok: false; error: string } {
    const existing = this.projects.get(id);
    if (!existing) return { ok: false, error: `Project "${id}" not found.` };

    const updated: ProjectMeta = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    try {
      this.writeJson(this.projectFile(id), updated);
    } catch (err) {
      return { ok: false, error: `Failed to update project: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.projects.set(id, updated);
    this.notifyChanged();
    return { ok: true, project: updated };
  }

  archive(id: string): { ok: true } | { ok: false; error: string } {
    const existing = this.projects.get(id);
    if (!existing) return { ok: false, error: `Project "${id}" not found.` };

    const dir = this.projectDir(id);
    const archiveDir = path.join(dir, 'archive');

    try {
      fs.mkdirSync(archiveDir, { recursive: true });

      // Move completed plans and their task lists to archive
      const plansDir = path.join(dir, 'plans');
      const tasksDir = path.join(dir, 'tasks');

      if (fs.existsSync(plansDir)) {
        for (const file of fs.readdirSync(plansDir)) {
          const src = path.join(plansDir, file);
          const dest = path.join(archiveDir, `plan-${file}`);
          fs.renameSync(src, dest);
        }
      }

      if (fs.existsSync(tasksDir)) {
        for (const file of fs.readdirSync(tasksDir)) {
          const src = path.join(tasksDir, file);
          const dest = path.join(archiveDir, `tasks-${file}`);
          fs.renameSync(src, dest);
        }
      }

      const reviewsDir = path.join(dir, 'reviews');
      if (fs.existsSync(reviewsDir)) {
        for (const file of fs.readdirSync(reviewsDir)) {
          const src = path.join(reviewsDir, file);
          const dest = path.join(archiveDir, `review-${file}`);
          fs.renameSync(src, dest);
        }
      }

      // Update project status
      const updated: ProjectMeta = {
        ...existing,
        status: 'archived',
        updatedAt: new Date().toISOString(),
      };
      this.writeJson(this.projectFile(id), updated);
      this.projects.set(id, updated);
      this.notifyChanged();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Failed to archive: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ── Plans ────────────────────────────────────────────────────────────

  listPlans(projectId: string): Plan[] {
    const dir = path.join(this.projectDir(projectId), 'plans');
    if (!fs.existsSync(dir)) return [];

    const plans: Plan[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const data = this.readJson<Plan>(path.join(dir, file));
      if (data) plans.push(data);
    }
    return plans.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getPlan(projectId: string, planId: string): Plan | undefined {
    const filePath = this.planFile(projectId, planId);
    return this.readJson<Plan>(filePath) ?? undefined;
  }

  createPlan(
    projectId: string,
    params: {
      title: string;
      objective?: string;
      scope?: string;
      steps?: PlanStep[];
      testStrategy?: string;
      reviewRequired?: boolean;
      markdownBody?: string;
    },
  ): { ok: true; plan: Plan } | { ok: false; error: string } {
    if (!this.projects.has(projectId)) return { ok: false, error: `Project "${projectId}" not found.` };

    const id = this.slugify(params.title);
    const filePath = this.planFile(projectId, id);
    if (fs.existsSync(filePath)) return { ok: false, error: `Plan "${id}" already exists in project "${projectId}".` };

    const now = new Date().toISOString();
    const plan: Plan = {
      id,
      projectId,
      title: params.title,
      objective: params.objective ?? '',
      scope: params.scope ?? '',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      steps: params.steps ?? [],
      testStrategy: params.testStrategy ?? '',
      reviewRequired: params.reviewRequired ?? true,
      markdownBody: params.markdownBody ?? '',
    };

    try {
      this.writeJson(filePath, plan);
      // Also write the markdown version
      if (plan.markdownBody) {
        const mdPath = path.join(this.projectDir(projectId), 'plans', `${id}.md`);
        fs.writeFileSync(mdPath, plan.markdownBody, 'utf-8');
      }
    } catch (err) {
      return { ok: false, error: `Failed to create plan: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.notifyChanged();
    return { ok: true, plan };
  }

  updatePlan(
    projectId: string,
    planId: string,
    patch: Partial<Omit<Plan, 'id' | 'projectId' | 'createdAt'>>,
  ): { ok: true; plan: Plan } | { ok: false; error: string } {
    const existing = this.getPlan(projectId, planId);
    if (!existing) return { ok: false, error: `Plan "${planId}" not found in project "${projectId}".` };

    const updated: Plan = {
      ...existing,
      ...patch,
      id: existing.id,
      projectId: existing.projectId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    if (patch.status === 'approved' && !existing.approvedAt) {
      updated.approvedAt = new Date().toISOString();
    }
    if (patch.status === 'completed' && !existing.completedAt) {
      updated.completedAt = new Date().toISOString();
    }

    try {
      this.writeJson(this.planFile(projectId, planId), updated);
      if (updated.markdownBody) {
        const mdPath = path.join(this.projectDir(projectId), 'plans', `${planId}.md`);
        fs.writeFileSync(mdPath, updated.markdownBody, 'utf-8');
      }
    } catch (err) {
      return { ok: false, error: `Failed to update plan: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.notifyChanged();
    return { ok: true, plan: updated };
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  listTasks(projectId: string, planId?: string): Task[] {
    const filePath = this.taskFile(projectId, planId);
    const taskList = this.readJson<TaskList>(filePath);
    return taskList?.tasks ?? [];
  }

  createTask(
    projectId: string,
    params: {
      description: string;
      planId?: string;
      planStepId?: string;
      status?: TaskStatus;
      assignee?: string;
      result?: string;
      notes?: string;
    },
  ): { ok: true; task: Task } | { ok: false; error: string } {
    if (!this.projects.has(projectId)) return { ok: false, error: `Project "${projectId}" not found.` };

    const now = new Date().toISOString();
    const task: Task = {
      id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      planId: params.planId,
      planStepId: params.planStepId,
      description: params.description,
      status: params.status ?? 'pending',
      assignee: params.assignee,
      createdAt: now,
      updatedAt: now,
      result: params.result,
      notes: params.notes,
      completedAt: params.status === 'completed' ? now : undefined,
    };

    const filePath = this.taskFile(projectId, params.planId);
    const existing = this.readJson<TaskList>(filePath);
    const taskList: TaskList = existing ?? {
      projectId,
      planId: params.planId,
      tasks: [],
      createdAt: now,
      updatedAt: now,
    };

    taskList.tasks.push(task);
    taskList.updatedAt = now;

    try {
      this.writeJson(filePath, taskList);
    } catch (err) {
      return { ok: false, error: `Failed to create task: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.notifyChanged();
    return { ok: true, task };
  }

  updateTask(
    projectId: string,
    taskId: string,
    patch: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>,
  ): { ok: true; task: Task } | { ok: false; error: string } {
    // Search all task files for this task
    const dir = path.join(this.projectDir(projectId), 'tasks');
    if (!fs.existsSync(dir)) return { ok: false, error: `No tasks found in project "${projectId}".` };

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dir, file);
      const taskList = this.readJson<TaskList>(filePath);
      if (!taskList) continue;

      const idx = taskList.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) continue;

      const now = new Date().toISOString();
      const updated: Task = {
        ...taskList.tasks[idx],
        ...patch,
        id: taskList.tasks[idx].id,
        projectId: taskList.tasks[idx].projectId,
        createdAt: taskList.tasks[idx].createdAt,
        updatedAt: now,
      };

      if (patch.status === 'completed' && !taskList.tasks[idx].completedAt) {
        updated.completedAt = now;
      }

      taskList.tasks[idx] = updated;
      taskList.updatedAt = now;

      try {
        this.writeJson(filePath, taskList);
      } catch (err) {
        return { ok: false, error: `Failed to update task: ${err instanceof Error ? err.message : String(err)}` };
      }

      this.notifyChanged();
      return { ok: true, task: updated };
    }

    return { ok: false, error: `Task "${taskId}" not found in project "${projectId}".` };
  }

  // ── Reviews ──────────────────────────────────────────────────────────

  listReviews(projectId: string): Review[] {
    const dir = path.join(this.projectDir(projectId), 'reviews');
    if (!fs.existsSync(dir)) return [];

    const reviews: Review[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const data = this.readJson<Review>(path.join(dir, file));
      if (data) reviews.push(data);
    }
    return reviews.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createReview(
    projectId: string,
    params: {
      title: string;
      planId?: string;
      reviewedFiles?: string[];
      findings?: ReviewFinding[];
      summary?: string;
      status?: ReviewStatus;
    },
  ): { ok: true; review: Review } | { ok: false; error: string } {
    if (!this.projects.has(projectId)) return { ok: false, error: `Project "${projectId}" not found.` };

    const now = new Date().toISOString();
    const id = `review-${this.slugify(params.title)}-${Date.now()}`;
    const review: Review = {
      id,
      projectId,
      planId: params.planId,
      title: params.title,
      status: params.status ?? 'pending',
      reviewedFiles: params.reviewedFiles ?? [],
      findings: params.findings ?? [],
      summary: params.summary ?? '',
      createdAt: now,
      completedAt: params.status === 'completed' ? now : undefined,
    };

    try {
      this.writeJson(this.reviewFile(projectId, id), review);
    } catch (err) {
      return { ok: false, error: `Failed to create review: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.notifyChanged();
    return { ok: true, review };
  }

  updateReview(
    projectId: string,
    reviewId: string,
    patch: Partial<Omit<Review, 'id' | 'projectId' | 'createdAt'>>,
  ): { ok: true; review: Review } | { ok: false; error: string } {
    const filePath = this.reviewFile(projectId, reviewId);
    const existing = this.readJson<Review>(filePath);
    if (!existing) return { ok: false, error: `Review "${reviewId}" not found in project "${projectId}".` };

    const now = new Date().toISOString();
    const updated: Review = {
      ...existing,
      ...patch,
      id: existing.id,
      projectId: existing.projectId,
      createdAt: existing.createdAt,
    };

    if (patch.status === 'completed' && !existing.completedAt) {
      updated.completedAt = now;
    }

    try {
      this.writeJson(filePath, updated);
    } catch (err) {
      return { ok: false, error: `Failed to update review: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.notifyChanged();
    return { ok: true, review: updated };
  }

  // ── Conventions ──────────────────────────────────────────────────────

  addConvention(
    projectId: string,
    convention: ProjectConvention,
  ): { ok: true } | { ok: false; error: string } {
    const existing = this.projects.get(projectId);
    if (!existing) return { ok: false, error: `Project "${projectId}" not found.` };

    const dup = existing.conventions.find(
      (c) => c.category === convention.category && c.rule === convention.rule,
    );
    if (dup) return { ok: true }; // idempotent

    const updated = {
      ...existing,
      conventions: [...existing.conventions, convention],
      updatedAt: new Date().toISOString(),
    };

    try {
      this.writeJson(this.projectFile(projectId), updated);
    } catch (err) {
      return { ok: false, error: `Failed to add convention: ${err instanceof Error ? err.message : String(err)}` };
    }

    this.projects.set(projectId, updated);
    this.notifyChanged();
    return { ok: true };
  }

  // ── System Prompt ────────────────────────────────────────────────────

  systemPromptSnippet(): string {
    const active = this.getActive();
    if (!active) return '';

    const lines: string[] = [
      '## Active Project',
      '',
      `**${active.name}** (${active.type}, ${active.status})`,
      active.description,
    ];

    if (active.conventions.length > 0) {
      lines.push('', '### Conventions');
      for (const c of active.conventions) {
        lines.push(`- **${c.category}**: ${c.rule}`);
      }
    }

    if (active.guidelines.length > 0) {
      lines.push('', '### Guidelines');
      for (const g of active.guidelines) {
        lines.push(`- ${g}`);
      }
    }

    if (active.techStack && active.techStack.length > 0) {
      lines.push('', `**Tech stack:** ${active.techStack.join(', ')}`);
    }

    // Show active plan progress
    const plans = this.listPlans(active.id).filter(
      (p) => p.status === 'in-progress' || p.status === 'approved',
    );
    if (plans.length > 0) {
      lines.push('', '### Active Plans');
      for (const plan of plans) {
        const done = plan.steps.filter((s) => s.completed).length;
        const total = plan.steps.length;
        lines.push(`- **${plan.title}** (${plan.status}) — ${done}/${total} steps done`);
      }
    }

    lines.push(
      '',
      '### Project Workflow',
      'When working on this project:',
      '1. Follow established conventions above',
      '2. Create plans before starting complex work (`project/plan`)',
      '3. Log completed work as tasks (`project/task`)',
      '4. Record code reviews for significant changes (`project/review`)',
      '5. Use `project/status` for a dashboard summary',
    );

    return lines.join('\n');
  }

  // ── Dashboard ────────────────────────────────────────────────────────

  getDashboard(projectId: string): string {
    const project = this.projects.get(projectId);
    if (!project) return `Project "${projectId}" not found.`;

    const plans = this.listPlans(projectId);
    const allTasks = this.listTasks(projectId);
    const reviews = this.listReviews(projectId);

    const lines: string[] = [
      `# ${project.name}`,
      `Type: ${project.type} | Status: ${project.status}`,
      `Description: ${project.description}`,
      `Created: ${project.createdAt}`,
      '',
    ];

    // Plans summary
    lines.push(`## Plans (${plans.length})`);
    if (plans.length === 0) {
      lines.push('No plans yet.');
    } else {
      for (const plan of plans) {
        const done = plan.steps.filter((s) => s.completed).length;
        const total = plan.steps.length;
        lines.push(`- [${plan.status}] ${plan.title} — ${done}/${total} steps`);
      }
    }

    // Tasks summary
    const tasksByStatus = new Map<string, number>();
    for (const t of allTasks) {
      tasksByStatus.set(t.status, (tasksByStatus.get(t.status) ?? 0) + 1);
    }
    lines.push('', `## Tasks (${allTasks.length})`);
    if (allTasks.length === 0) {
      lines.push('No tasks yet.');
    } else {
      for (const [status, count] of tasksByStatus) {
        lines.push(`- ${status}: ${count}`);
      }
    }

    // Reviews summary
    lines.push('', `## Reviews (${reviews.length})`);
    if (reviews.length === 0) {
      lines.push('No reviews yet.');
    } else {
      for (const r of reviews) {
        const findings = r.findings.length;
        const critical = r.findings.filter((f) => f.severity === 'critical').length;
        lines.push(`- [${r.status}] ${r.title} — ${findings} findings${critical > 0 ? ` (${critical} critical)` : ''}`);
      }
    }

    // Conventions
    if (project.conventions.length > 0) {
      lines.push('', `## Conventions (${project.conventions.length})`);
      for (const c of project.conventions) {
        lines.push(`- [${c.category}] ${c.rule} (${c.source})`);
      }
    }

    return lines.join('\n');
  }

  // ── Scanning ─────────────────────────────────────────────────────────

  reload(): void {
    this.projects.clear();
    const root = workspaceRoot();
    if (!root) return;

    const base = projectsBaseDir(root);
    if (!fs.existsSync(base)) return;

    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const projectJsonPath = path.join(base, entry.name, 'project.json');
        const project = this.readJson<ProjectMeta>(projectJsonPath);
        if (project && project.id) {
          this.projects.set(project.id, project);
        }
      }
      logger.info(`ProjectManager: loaded ${this.projects.size} project(s)`);
    } catch (err) {
      logger.warn(`ProjectManager: scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private projectDir(id: string): string {
    const root = workspaceRoot();
    if (!root) throw new Error('No workspace folder open.');
    return path.join(projectsBaseDir(root), id);
  }

  private projectFile(id: string): string {
    return path.join(this.projectDir(id), 'project.json');
  }

  private planFile(projectId: string, planId: string): string {
    return path.join(this.projectDir(projectId), 'plans', `${planId}.json`);
  }

  private taskFile(projectId: string, planId?: string): string {
    const name = planId ?? 'adhoc';
    return path.join(this.projectDir(projectId), 'tasks', `${name}.json`);
  }

  private reviewFile(projectId: string, reviewId: string): string {
    return path.join(this.projectDir(projectId), 'reviews', `${reviewId}.json`);
  }

  private writeJson(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  private readJson<T>(filePath: string): T | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unnamed';
  }

  private notifyChanged(): void {
    this.onProjectChanged?.();
  }

  private installWatcher(): void {
    if (!vscode.workspace.workspaceFolders?.length) return;

    const schedule = () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer);
      this.reloadTimer = setTimeout(() => {
        this.reload();
        this.notifyChanged();
      }, 200);
    };

    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/.obotovs/projects/**/*',
    );
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidChange(schedule);
    this.watcher.onDidDelete(schedule);
  }
}
