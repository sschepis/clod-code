export const NO_SKILLS_GUIDE =
  '[INFO] No skills defined in this workspace.\n\n' +
  'Create markdown files under `.obotovs/skills/` to add skills. Each file may start ' +
  'with a `---` frontmatter block containing `name`, `description`, and optionally `when`:\n\n' +
  '```markdown\n' +
  '---\n' +
  'name: my-skill\n' +
  'description: Short one-liner the agent sees in its system prompt\n' +
  'when: User asks about X\n' +
  '---\n\n' +
  '# Body\n' +
  'Detailed instructions the agent loads with `skill get my-skill`.\n' +
  '```';

export function skillLoadedMessage(
  skill: { name: string; description?: string; when?: string; filePath: string; body: string },
): string {
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
}

export function skillListMessage(
  skills: Array<{ name: string; description: string; when?: string }>,
): string {
  const rows = skills.map((s) => {
    const whenPart = s.when ? `  (when: ${s.when})` : '';
    return `  ${s.name.padEnd(32)}  ${s.description}${whenPart}`;
  });
  return (
    `[SUCCESS] ${skills.length} skill${skills.length === 1 ? '' : 's'} available:\n\n` +
    rows.join('\n') +
    '\n\nLoad full instructions with `skill get <name>`.'
  );
}

export function skillNotFoundMessage(name: string, available: string): string {
  return (
    `[ERROR] Skill "${name}" not found.` +
    (available ? ` Available: ${available}` : ' No skills are defined.')
  );
}
