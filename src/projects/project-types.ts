export type ProjectType = 'new-build' | 'existing-codebase' | 'ad-hoc';
export type ProjectStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type PlanStatus = 'draft' | 'approved' | 'in-progress' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'blocked' | 'skipped';
export type ReviewStatus = 'pending' | 'approved' | 'changes-requested' | 'completed';

export interface ProjectConvention {
  category: string;
  rule: string;
  source: 'detected' | 'user-defined';
  examples?: string[];
}

export interface ProjectMeta {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string;
  createdAt: string;
  updatedAt: string;
  conventions: ProjectConvention[];
  guidelines: string[];
  techStack?: string[];
  entryPoints?: string[];
  activePlanId?: string;
}

export interface PlanStep {
  id: string;
  description: string;
  fileChanges?: Array<{
    path: string;
    action: 'create' | 'modify' | 'delete';
    description: string;
  }>;
  dependencies?: string[];
  testPlan?: string;
  completed: boolean;
  completedAt?: string;
}

export interface Plan {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  scope: string;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  completedAt?: string;
  steps: PlanStep[];
  dependencies?: string[];
  testStrategy: string;
  reviewRequired: boolean;
  markdownBody: string;
}

export interface Task {
  id: string;
  projectId: string;
  planId?: string;
  planStepId?: string;
  description: string;
  status: TaskStatus;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  notes?: string;
  blockedBy?: string;
}

export interface TaskList {
  projectId: string;
  planId?: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  file?: string;
  line?: number;
  description: string;
  resolved: boolean;
}

export interface Review {
  id: string;
  projectId: string;
  planId?: string;
  title: string;
  status: ReviewStatus;
  reviewedFiles: string[];
  findings: ReviewFinding[];
  summary: string;
  createdAt: string;
  completedAt?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  type: ProjectType;
  status: ProjectStatus;
  activePlanCount: number;
  taskCount: number;
  filePath: string;
}
