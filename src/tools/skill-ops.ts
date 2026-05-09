import type { SkillManager } from '../skills/skill-manager';
import {
  NO_SKILLS_GUIDE,
  skillLoadedMessage,
  skillListMessage,
  skillNotFoundMessage,
} from '../prompts';

export interface SkillToolDeps {
  manager: SkillManager;
}

/** `skill list` — list all available skills with descriptions. */
export function createSkillListHandler(deps: SkillToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const skills = deps.manager.list();
    if (skills.length === 0) {
      return NO_SKILLS_GUIDE;
    }
    return skillListMessage(skills);
  };
}

/** `skill get <name>` — return the full body of a skill. */
export function createSkillGetHandler(deps: SkillToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = typeof kwargs.name === 'string' ? kwargs.name.trim() : '';
    if (!name) return '[ERROR] Missing required argument: name';

    const skill = deps.manager.get(name);
    if (!skill) {
      const available = deps.manager.list().map((s) => s.name).join(', ');
      return skillNotFoundMessage(name, available);
    }

    return skillLoadedMessage(skill);
  };
}

/** `skill promote <name>` — copy a workspace skill to global scope. */
export function createSkillPromoteHandler(deps: SkillToolDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const name = typeof kwargs.name === 'string' ? kwargs.name.trim() : '';
    if (!name) return '[ERROR] Missing required argument: name. Use `skill list` to see available skills.';

    const skill = deps.manager.get(name);
    if (!skill) {
      const available = deps.manager.list().map((s) => s.name).join(', ');
      return skillNotFoundMessage(name, available);
    }

    const newPath = deps.manager.promote(name);
    if (!newPath) return `[ERROR] Skill "${name}" is already in global scope.`;

    return `[SUCCESS] Promoted "${name}" to global scope.\nPath: ${newPath}\nThis skill is now available in all workspaces.`;
  };
}

export function createSkillHandlers(deps: SkillToolDeps) {
  return {
    list: createSkillListHandler(deps),
    get: createSkillGetHandler(deps),
    promote: createSkillPromoteHandler(deps),
  };
}
