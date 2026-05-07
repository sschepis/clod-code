import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../shared/logger';

const TEMPLATES_SUBDIR = 'skills/templates';
const VERSION_FILE = '.version';

export function seedTemplatesIfNeeded(extensionPath: string): void {
  const src = path.join(extensionPath, 'assets', 'templates');
  if (!fs.existsSync(src)) return;

  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) return;
  const dest = path.join(homeDir, '.obotovs', TEMPLATES_SUBDIR);

  const srcVersion = readVersion(path.join(src, VERSION_FILE));
  const destVersion = readVersion(path.join(dest, VERSION_FILE));

  if (destVersion && destVersion >= srcVersion) return;

  fs.mkdirSync(dest, { recursive: true });

  const files = fs.readdirSync(src).filter(f => f.endsWith('.md'));
  for (const file of files) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }

  fs.writeFileSync(path.join(dest, VERSION_FILE), String(srcVersion));
  logger.info(`Seeded ${files.length} surface templates to ${dest}`);
}

function readVersion(filePath: string): number {
  try {
    return parseInt(fs.readFileSync(filePath, 'utf-8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}
