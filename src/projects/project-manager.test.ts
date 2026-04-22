import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock vscode before importing ProjectManager
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
import { ProjectManager } from './project-manager';
import { scanWorkspaceConventions } from './convention-scanner';

let tmpDir: string;

function setWorkspaceRoot(dir: string): void {
  (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: dir } }];
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  setWorkspaceRoot(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProjectManager', () => {
  it('creates a project with correct directory structure', () => {
    const pm = new ProjectManager({ onProjectChanged: vi.fn() });
    const result = pm.create({
      name: 'My Test App',
      type: 'new-build',
      description: 'A test project',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.project.id).toBe('my-test-app');
    expect(result.project.status).toBe('active');
    expect(result.project.type).toBe('new-build');

    const projectDir = path.join(tmpDir, '.obotovs', 'projects', 'my-test-app');
    expect(fs.existsSync(path.join(projectDir, 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'plans'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'tasks'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'reviews'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'archive'))).toBe(true);

    pm.dispose();
  });

  it('lists and retrieves projects', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Alpha', type: 'new-build', description: 'first' });
    pm.create({ name: 'Beta', type: 'ad-hoc', description: 'second' });

    const list = pm.list();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Alpha');
    expect(list[1].name).toBe('Beta');

    expect(pm.get('alpha')).toBeDefined();
    expect(pm.get('nonexistent')).toBeUndefined();

    pm.dispose();
  });

  it('prevents duplicate project creation', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Dup', type: 'ad-hoc', description: 'first' });
    const result = pm.create({ name: 'Dup', type: 'ad-hoc', description: 'second' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('already exists');
    }

    pm.dispose();
  });

  it('updates a project', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Updatable', type: 'new-build', description: 'orig' });

    const result = pm.update('updatable', { description: 'updated desc', status: 'paused' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.project.description).toBe('updated desc');
    expect(result.project.status).toBe('paused');

    pm.dispose();
  });

  it('getActive returns the first active project', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Active One', type: 'new-build', description: 'active' });
    pm.create({ name: 'Paused', type: 'ad-hoc', description: 'paused' });
    pm.update('paused', { status: 'paused' });

    const active = pm.getActive();
    expect(active).toBeDefined();
    expect(active!.name).toBe('Active One');

    pm.dispose();
  });

  it('reloads projects from disk', () => {
    const pm1 = new ProjectManager({});
    pm1.create({ name: 'Persisted', type: 'new-build', description: 'test' });
    pm1.dispose();

    const pm2 = new ProjectManager({});
    expect(pm2.get('persisted')).toBeDefined();
    expect(pm2.get('persisted')!.name).toBe('Persisted');
    pm2.dispose();
  });
});

describe('ProjectManager — Plans', () => {
  it('creates and retrieves a plan', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Planned', type: 'new-build', description: 'test' });

    const result = pm.createPlan('planned', {
      title: 'Auth Feature',
      objective: 'Add authentication',
      scope: 'Backend only',
      testStrategy: 'Unit tests on all endpoints',
      markdownBody: '# Auth Feature\n\nDetailed plan here...',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.id).toBe('auth-feature');
    expect(result.plan.status).toBe('draft');

    const plans = pm.listPlans('planned');
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe('Auth Feature');

    const fetched = pm.getPlan('planned', 'auth-feature');
    expect(fetched).toBeDefined();
    expect(fetched!.objective).toBe('Add authentication');

    // Verify markdown file was also written
    const mdPath = path.join(tmpDir, '.obotovs', 'projects', 'planned', 'plans', 'auth-feature.md');
    expect(fs.existsSync(mdPath)).toBe(true);

    pm.dispose();
  });

  it('updates plan status with timestamp tracking', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'PlanUpdate', type: 'new-build', description: 'test' });
    pm.createPlan('planupdate', { title: 'Feature X' });

    const approved = pm.updatePlan('planupdate', 'feature-x', { status: 'approved' });
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.plan.approvedAt).toBeDefined();
    }

    const completed = pm.updatePlan('planupdate', 'feature-x', { status: 'completed' });
    expect(completed.ok).toBe(true);
    if (completed.ok) {
      expect(completed.plan.completedAt).toBeDefined();
    }

    pm.dispose();
  });
});

describe('ProjectManager — Tasks', () => {
  it('creates tasks (ad-hoc and plan-linked)', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Tasked', type: 'ad-hoc', description: 'test' });

    // Ad-hoc task
    const t1 = pm.createTask('tasked', { description: 'Fix a bug' });
    expect(t1.ok).toBe(true);
    if (t1.ok) expect(t1.task.planId).toBeUndefined();

    // Plan-linked task
    pm.createPlan('tasked', { title: 'Plan A' });
    const t2 = pm.createTask('tasked', { description: 'Step 1', planId: 'plan-a' });
    expect(t2.ok).toBe(true);

    // List all tasks
    const adhoc = pm.listTasks('tasked');
    expect(adhoc).toHaveLength(1);

    const planTasks = pm.listTasks('tasked', 'plan-a');
    expect(planTasks).toHaveLength(1);

    pm.dispose();
  });

  it('updates a task status', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'TaskUpdate', type: 'ad-hoc', description: 'test' });

    const created = pm.createTask('taskupdate', { description: 'Do something' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = pm.updateTask('taskupdate', created.task.id, {
      status: 'completed',
      result: 'Done successfully',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.task.status).toBe('completed');
      expect(result.task.completedAt).toBeDefined();
      expect(result.task.result).toBe('Done successfully');
    }

    pm.dispose();
  });
});

describe('ProjectManager — Reviews', () => {
  it('creates and updates a review', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Reviewed', type: 'new-build', description: 'test' });

    const created = pm.createReview('reviewed', {
      title: 'Auth Module Review',
      reviewedFiles: ['src/auth.ts', 'src/auth.test.ts'],
      findings: [
        { severity: 'minor', file: 'src/auth.ts', line: 42, description: 'Missing error handling', resolved: false },
      ],
      summary: 'Overall looks good, one minor issue.',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.review.findings).toHaveLength(1);

    const reviews = pm.listReviews('reviewed');
    expect(reviews).toHaveLength(1);

    const updated = pm.updateReview('reviewed', created.review.id, {
      status: 'completed',
      findings: [
        { severity: 'minor', file: 'src/auth.ts', line: 42, description: 'Missing error handling', resolved: true },
      ],
    });

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.review.status).toBe('completed');
      expect(updated.review.completedAt).toBeDefined();
    }

    pm.dispose();
  });
});

describe('ProjectManager — Archive', () => {
  it('archives a project, moving plans/tasks/reviews', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Archivable', type: 'new-build', description: 'test' });
    pm.createPlan('archivable', { title: 'Plan One' });
    pm.createTask('archivable', { description: 'Task one', planId: 'plan-one' });
    pm.createReview('archivable', { title: 'Review One' });

    const result = pm.archive('archivable');
    expect(result.ok).toBe(true);

    const project = pm.get('archivable');
    expect(project!.status).toBe('archived');

    const archiveDir = path.join(tmpDir, '.obotovs', 'projects', 'archivable', 'archive');
    const files = fs.readdirSync(archiveDir);
    expect(files.some((f) => f.startsWith('plan-'))).toBe(true);
    expect(files.some((f) => f.startsWith('tasks-'))).toBe(true);
    expect(files.some((f) => f.startsWith('review-'))).toBe(true);

    pm.dispose();
  });
});

describe('ProjectManager — Conventions', () => {
  it('adds conventions and deduplicates', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Conv', type: 'existing-codebase', description: 'test' });

    pm.addConvention('conv', { category: 'naming', rule: 'Use kebab-case', source: 'detected' });
    pm.addConvention('conv', { category: 'naming', rule: 'Use kebab-case', source: 'detected' }); // duplicate

    const project = pm.get('conv')!;
    expect(project.conventions).toHaveLength(1);

    pm.dispose();
  });
});

describe('ProjectManager — System Prompt', () => {
  it('returns empty when no active project', () => {
    const pm = new ProjectManager({});
    expect(pm.systemPromptSnippet()).toBe('');
    pm.dispose();
  });

  it('returns project context when active', () => {
    const pm = new ProjectManager({});
    pm.create({
      name: 'Active Project',
      type: 'existing-codebase',
      description: 'A real project',
      conventions: [{ category: 'testing', rule: 'Use Vitest', source: 'detected' }],
      guidelines: ['All code must have tests'],
      techStack: ['TypeScript', 'React'],
    });

    const snippet = pm.systemPromptSnippet();
    expect(snippet).toContain('Active Project');
    expect(snippet).toContain('existing-codebase');
    expect(snippet).toContain('Use Vitest');
    expect(snippet).toContain('All code must have tests');
    expect(snippet).toContain('TypeScript, React');

    pm.dispose();
  });
});

describe('ProjectManager — Dashboard', () => {
  it('returns formatted dashboard', () => {
    const pm = new ProjectManager({});
    pm.create({ name: 'Dashboard Test', type: 'new-build', description: 'Testing dashboard' });
    pm.createPlan('dashboard-test', { title: 'Plan A', objective: 'Build stuff' });
    pm.createTask('dashboard-test', { description: 'Do thing', status: 'completed', result: 'Done' });
    pm.createTask('dashboard-test', { description: 'Another thing' });

    const dashboard = pm.getDashboard('dashboard-test');
    expect(dashboard).toContain('Dashboard Test');
    expect(dashboard).toContain('Plans (1)');
    expect(dashboard).toContain('Tasks (2)');
    expect(dashboard).toContain('completed: 1');
    expect(dashboard).toContain('pending: 1');

    pm.dispose();
  });
});

describe('ProjectManager — slugify', () => {
  it('handles various name formats', () => {
    const pm = new ProjectManager({});

    // Test via create which uses slugify internally
    const r1 = pm.create({ name: 'Hello World', type: 'ad-hoc', description: 't' });
    expect(r1.ok && r1.project.id).toBe('hello-world');

    const r2 = pm.create({ name: '  Spaces & Special!Chars  ', type: 'ad-hoc', description: 't' });
    expect(r2.ok && r2.project.id).toBe('spaces-special-chars');

    const r3 = pm.create({ name: '---Leading-Trailing---', type: 'ad-hoc', description: 't' });
    expect(r3.ok && r3.project.id).toBe('leading-trailing');

    pm.dispose();
  });
});

describe('Convention Scanner', () => {
  it('detects package.json tech stack', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18.0.0', next: '^14.0.0' },
        devDependencies: { typescript: '^5.0.0', vitest: '^2.0.0' },
        type: 'module',
      }),
    );

    const result = scanWorkspaceConventions(tmpDir);
    expect(result.techStack).toContain('React');
    expect(result.techStack).toContain('Next.js');
    expect(result.techStack).toContain('TypeScript');
    expect(result.techStack).toContain('Vitest');
    expect(result.conventions.some((c) => c.category === 'testing' && c.rule.includes('Vitest'))).toBe(true);
    expect(result.conventions.some((c) => c.category === 'imports' && c.rule.includes('ES module'))).toBe(true);
  });

  it('detects TypeScript config', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

    const result = scanWorkspaceConventions(tmpDir);
    expect(result.conventions.some((c) => c.category === 'language' && c.rule.includes('TypeScript'))).toBe(true);
  });

  it('detects co-located test files', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'app.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'app.test.ts'), '');

    const result = scanWorkspaceConventions(tmpDir);
    expect(result.conventions.some((c) => c.category === 'testing' && c.rule.includes('co-located'))).toBe(true);
  });

  it('detects file naming conventions', () => {
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'my-component.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'user-service.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'api-client.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'data-store.ts'), '');

    const result = scanWorkspaceConventions(tmpDir);
    expect(result.conventions.some((c) => c.category === 'naming' && c.rule.includes('kebab-case'))).toBe(true);
  });
});
