import type { SkillManager } from '../skills/skill-manager';

export interface SkillToolDeps {
  manager: SkillManager;
}

/** `skill list` — list all available skills with descriptions. */
export function createSkillListHandler(deps: SkillToolDeps) {
  return async (_kwargs: Record<string, unknown>): Promise<string> => {
    const skills = deps.manager.list();
    if (skills.length === 0) {
      return (
        '[INFO] No skills defined in this workspace.\n\n' +
        'Create markdown files under `.clodcode/skills/` to add skills. Each file may start ' +
        'with a `---` frontmatter block containing `name`, `description`, and optionally `when`:\n\n' +
        '```markdown\n' +
        '---\n' +
        'name: my-skill\n' +
        'description: Short one-liner the agent sees in its system prompt\n' +
        'when: User asks about X\n' +
        '---\n\n' +
        '# Body\n' +
        'Detailed instructions the agent loads with `skill get my-skill`.\n' +
        '```'
      );
    }

    const rows = skills.map((s) => {
      const whenPart = s.when ? `  (when: ${s.when})` : '';
      return `  ${s.name.padEnd(32)}  ${s.description}${whenPart}`;
    });
    return (
      `[SUCCESS] ${skills.length} skill${skills.length === 1 ? '' : 's'} available:\n\n` +
      rows.join('\n') +
      '\n\nLoad full instructions with `skill get <name>`.'
    );
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
      return (
        `[ERROR] Skill "${name}" not found.` +
        (available ? ` Available: ${available}` : ' No skills are defined.')
      );
    }

    const header = [
      `# Skill: ${skill.name}`,
      skill.description ? `\nDescription: ${skill.description}` : '',
      skill.when ? `When to use: ${skill.when}` : '',
      `\nSource: ${skill.filePath}`,
    ]
      .filter(Boolean)
      .join('\n');

    return (
      `[SKILL LOADED]\n${header}\n\n---\n\n${skill.body}\n\n---\n\n` +
      'Follow the instructions above for the remainder of this turn.'
    );
  };
}

export function createSkillHandlers(deps: SkillToolDeps) {
  return {
    list: createSkillListHandler(deps),
    get: createSkillGetHandler(deps),
  };
}
