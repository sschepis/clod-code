import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    createFileSystemWatcher: () => ({
      onDidCreate: vi.fn(),
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}));

import * as vscode from 'vscode';
import { ProjectManager } from '../projects/project-manager';
import {
  createProjectInitHandler,
  createProjectListHandler,
  createProjectGetHandler,
  createProjectUpdateHandler,
  createProjectPlanCreateHandler,
  createProjectPlanUpdateHandler,
  createProjectPlanListHandler,
  createProjectTaskCreateHandler,
  createProjectTaskUpdateHandler,
  createProjectTaskListHandler,
  createProjectReviewCreateHandler,
  createProjectReviewUpdateHandler,
  createProjectStatusHandler,
  createProjectArchiveHandler,
} from './project-ops';

let tmpDir: string;
let pm: ProjectManager;

function setWorkspaceRoot(dir: string): void {
  (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: dir } }];
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-test-'));
  setWorkspaceRoot(tmpDir);
  pm = new ProjectManager({});
});

afterEach(() => {
  pm.dispose();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const deps = () => ({ manager: pm });

describe('project/init handler', () => {
  it('creates a project with valid args', async () => {
    const handler = createProjectInitHandler(deps());
    const result = await handler({ name: 'Test App', type: 'new-build', description: 'A test' });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('Test App');
    expect(pm.get('test-app')).toBeDefined();
  });

  it('returns error for missing name', async () => {
    const handler = createProjectInitHandler(deps());
    const result = await handler({ type: 'new-build' });
    expect(result).toContain('[ERROR]');
    expect(result).toContain('name');
  });

  it('returns error for invalid type', async () => {
    const handler = createProjectInitHandler(deps());
    const result = await handler({ name: 'Test', type: 'invalid' });
    expect(result).toContain('[ERROR]');
    expect(result).toContain('Invalid type');
  });

  it('scans conventions for existing-codebase type', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '^5.0.0' } }),
    );
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const handler = createProjectInitHandler(deps());
    const result = await handler({ name: 'Existing', type: 'existing-codebase' });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('convention');
  });
});

describe('project/list handler', () => {
  it('returns empty message when no projects', async () => {
    const handler = createProjectListHandler(deps());
    const result = await handler({});
    expect(result).toContain('No projects');
  });

  it('lists created projects', async () => {
    pm.create({ name: 'Alpha', type: 'ad-hoc', description: 'first' });
    pm.create({ name: 'Beta', type: 'new-build', description: 'second' });

    const handler = createProjectListHandler(deps());
    const result = await handler({});
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
  });
});

describe('project/get handler', () => {
  it('returns error for missing id', async () => {
    const handler = createProjectGetHandler(deps());
    const result = await handler({});
    expect(result).toContain('[ERROR]');
  });

  it('returns dashboard for valid project', async () => {
    pm.create({ name: 'Dashboard', type: 'ad-hoc', description: 'test' });
    const handler = createProjectGetHandler(deps());
    const result = await handler({ id: 'dashboard' });
    expect(result).toContain('Dashboard');
    expect(result).toContain('Plans');
    expect(result).toContain('Tasks');
  });
});

describe('project/update handler', () => {
  it('updates project fields', async () => {
    pm.create({ name: 'Updateable', type: 'ad-hoc', description: 'orig' });
    const handler = createProjectUpdateHandler(deps());
    const result = await handler({ id: 'updateable', description: 'new desc' });
    expect(result).toContain('[SUCCESS]');
    expect(pm.get('updateable')!.description).toBe('new desc');
  });

  it('returns error when no fields given', async () => {
    pm.create({ name: 'Noop', type: 'ad-hoc', description: 'test' });
    const handler = createProjectUpdateHandler(deps());
    const result = await handler({ id: 'noop' });
    expect(result).toContain('[ERROR]');
    expect(result).toContain('No fields');
  });
});

describe('project/plan handlers', () => {
  beforeEach(() => {
    pm.create({ name: 'Planned', type: 'new-build', description: 'test' });
  });

  it('creates a plan', async () => {
    const handler = createProjectPlanCreateHandler(deps());
    const result = await handler({
      project_id: 'planned',
      title: 'Auth Feature',
      objective: 'Add auth',
    });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('auth-feature');
  });

  it('lists plans', async () => {
    pm.createPlan('planned', { title: 'Plan A' });
    pm.createPlan('planned', { title: 'Plan B' });

    const handler = createProjectPlanListHandler(deps());
    const result = await handler({ project_id: 'planned' });
    expect(result).toContain('Plan A');
    expect(result).toContain('Plan B');
  });

  it('updates plan status', async () => {
    pm.createPlan('planned', { title: 'Updatable Plan' });
    const handler = createProjectPlanUpdateHandler(deps());
    const result = await handler({
      project_id: 'planned',
      plan_id: 'updatable-plan',
      status: 'approved',
    });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('approved');
  });
});

describe('project/task handlers', () => {
  beforeEach(() => {
    pm.create({ name: 'Tasked', type: 'ad-hoc', description: 'test' });
  });

  it('creates a task', async () => {
    const handler = createProjectTaskCreateHandler(deps());
    const result = await handler({
      project_id: 'tasked',
      description: 'Fix the bug',
    });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('Fix the bug');
  });

  it('updates a task', async () => {
    const created = pm.createTask('tasked', { description: 'Do thing' });
    if (!created.ok) throw new Error('Task creation failed');

    const handler = createProjectTaskUpdateHandler(deps());
    const result = await handler({
      project_id: 'tasked',
      task_id: created.task.id,
      status: 'completed',
      result: 'Done',
    });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('completed');
  });

  it('lists tasks', async () => {
    pm.createTask('tasked', { description: 'Task 1' });
    pm.createTask('tasked', { description: 'Task 2', status: 'completed' });

    const handler = createProjectTaskListHandler(deps());
    const result = await handler({ project_id: 'tasked' });
    expect(result).toContain('Task 1');
    expect(result).toContain('Task 2');
  });

  it('filters tasks by status', async () => {
    pm.createTask('tasked', { description: 'Pending one' });
    pm.createTask('tasked', { description: 'Done one', status: 'completed' });

    const handler = createProjectTaskListHandler(deps());
    const result = await handler({ project_id: 'tasked', status: 'completed' });
    expect(result).toContain('Done one');
    expect(result).not.toContain('Pending one');
  });
});

describe('project/review handlers', () => {
  beforeEach(() => {
    pm.create({ name: 'Reviewed', type: 'new-build', description: 'test' });
  });

  it('creates a review', async () => {
    const handler = createProjectReviewCreateHandler(deps());
    const result = await handler({
      project_id: 'reviewed',
      title: 'Auth Review',
      reviewed_files: '["src/auth.ts"]',
      findings: '[{"severity":"minor","description":"Missing check","resolved":false}]',
      summary: 'Looks okay',
    });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('findings: 1');
  });

  it('updates a review', async () => {
    const created = pm.createReview('reviewed', { title: 'Update Me' });
    if (!created.ok) throw new Error('Review creation failed');

    const handler = createProjectReviewUpdateHandler(deps());
    const result = await handler({
      project_id: 'reviewed',
      review_id: created.review.id,
      status: 'completed',
    });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('completed');
  });
});

describe('project/status handler', () => {
  it('returns dashboard', async () => {
    pm.create({ name: 'Status Test', type: 'new-build', description: 'testing' });
    const handler = createProjectStatusHandler(deps());
    const result = await handler({ project_id: 'status-test' });
    expect(result).toContain('Status Test');
    expect(result).toContain('Plans');
  });
});

describe('project/archive handler', () => {
  it('archives a project', async () => {
    pm.create({ name: 'Archivable', type: 'ad-hoc', description: 'test' });
    pm.createTask('archivable', { description: 'task' });

    const handler = createProjectArchiveHandler(deps());
    const result = await handler({ project_id: 'archivable' });
    expect(result).toContain('[SUCCESS]');
    expect(result).toContain('archived');

    expect(pm.get('archivable')!.status).toBe('archived');
  });
});
