import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { logger } from '../shared/logger';
import type { AgentToolDeps } from '../tools/agent-deps';

export interface DynamicToolDef {
  name: string;
  description: string;
  requiredArgs?: Record<string, { type: string; description: string; default?: any }>;
  optionalArgs?: Record<string, { type: string; description: string; default?: any }>;
  handler: (kwargs: Record<string, any>, deps: AgentToolDeps) => Promise<any> | any;
}

export function loadDynamicTools(): DynamicToolDef[] {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return [];

  const root = workspaceFolders[0].uri.fsPath;
  const toolsDir = path.join(root, '.obotovs', 'tools');

  if (!fs.existsSync(toolsDir)) return [];

  const tools: DynamicToolDef[] = [];
  const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(toolsDir, file);
    try {
      const code = fs.readFileSync(filePath, 'utf8');
      
      const module = { exports: {} as any };
      const wrapper = new Function('module', 'exports', 'require', '__dirname', '__filename', code);
      wrapper(module, module.exports, require, toolsDir, filePath);

      const def = module.exports;
      if (!def.name || !def.description || typeof def.handler !== 'function') {
        logger.warn(`Dynamic tool ${file} is missing required fields (name, description, handler)`);
        continue;
      }
      tools.push(def);
    } catch (err) {
      logger.error(`Failed to load dynamic tool ${file}:`, err);
    }
  }

  return tools;
}
