import * as fs from 'fs';
import * as path from 'path';
import type { ProjectConvention } from './project-types';

export interface ScanResult {
  conventions: ProjectConvention[];
  techStack: string[];
  entryPoints: string[];
}

export function scanWorkspaceConventions(root: string): ScanResult {
  const conventions: ProjectConvention[] = [];
  const techStack: string[] = [];
  const entryPoints: string[] = [];

  detectPackageJson(root, conventions, techStack, entryPoints);
  detectTestPatterns(root, conventions);
  detectFileNaming(root, conventions);
  detectLintingConfig(root, conventions);

  return { conventions, techStack, entryPoints };
}

function detectPackageJson(
  root: string,
  conventions: ProjectConvention[],
  techStack: string[],
  entryPoints: string[],
): void {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    // Tech stack from dependencies
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const known: Record<string, string> = {
      react: 'React',
      vue: 'Vue',
      angular: 'Angular',
      svelte: 'Svelte',
      next: 'Next.js',
      nuxt: 'Nuxt',
      express: 'Express',
      fastify: 'Fastify',
      typescript: 'TypeScript',
      vitest: 'Vitest',
      jest: 'Jest',
      mocha: 'Mocha',
      tailwindcss: 'Tailwind CSS',
      prisma: 'Prisma',
      drizzle: 'Drizzle',
      webpack: 'Webpack',
      vite: 'Vite',
      esbuild: 'esbuild',
      rollup: 'Rollup',
    };

    for (const [dep, label] of Object.entries(known)) {
      if (allDeps[dep]) techStack.push(label);
    }

    // Entry points
    if (pkg.main) entryPoints.push(pkg.main);
    if (pkg.module) entryPoints.push(pkg.module);

    // Test framework convention
    if (allDeps.vitest) {
      conventions.push({
        category: 'testing',
        rule: 'Use Vitest for unit tests',
        source: 'detected',
      });
    } else if (allDeps.jest) {
      conventions.push({
        category: 'testing',
        rule: 'Use Jest for unit tests',
        source: 'detected',
      });
    } else if (allDeps.mocha) {
      conventions.push({
        category: 'testing',
        rule: 'Use Mocha for unit tests',
        source: 'detected',
      });
    }

    // Module type
    if (pkg.type === 'module') {
      conventions.push({
        category: 'imports',
        rule: 'Use ES module imports (package.json type=module)',
        source: 'detected',
      });
    }

    // Scripts as indicators
    if (pkg.scripts?.lint) {
      conventions.push({
        category: 'quality',
        rule: `Lint command available: \`${pkg.scripts.lint}\``,
        source: 'detected',
      });
    }
    if (pkg.scripts?.format) {
      conventions.push({
        category: 'quality',
        rule: `Format command available: \`${pkg.scripts.format}\``,
        source: 'detected',
      });
    }
  } catch {
    // Ignore parse errors
  }
}

function detectTestPatterns(root: string, conventions: ProjectConvention[]): void {
  // Check for common test file location patterns
  const patterns = [
    { dir: 'test', label: 'Tests in top-level test/ directory' },
    { dir: 'tests', label: 'Tests in top-level tests/ directory' },
    { dir: '__tests__', label: 'Tests in __tests__/ directories (Jest convention)' },
    { dir: 'spec', label: 'Tests in spec/ directory' },
  ];

  for (const { dir, label } of patterns) {
    if (fs.existsSync(path.join(root, dir))) {
      conventions.push({ category: 'testing', rule: label, source: 'detected' });
      return;
    }
  }

  // Check for co-located test files in src/
  const srcDir = path.join(root, 'src');
  if (fs.existsSync(srcDir)) {
    const hasColocated = findFileMatching(srcDir, /\.(test|spec)\.(ts|tsx|js|jsx)$/, 3);
    if (hasColocated) {
      conventions.push({
        category: 'testing',
        rule: 'Tests are co-located with source files (*.test.ts / *.spec.ts)',
        source: 'detected',
      });
    }
  }
}

function detectFileNaming(root: string, conventions: ProjectConvention[]): void {
  const srcDir = path.join(root, 'src');
  if (!fs.existsSync(srcDir)) return;

  const files = collectFileNames(srcDir, 2);
  if (files.length < 3) return;

  // Count naming patterns
  let kebab = 0;
  let camel = 0;
  let pascal = 0;

  for (const name of files) {
    const stem = name.replace(/\.[^.]+$/, '');
    if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(stem)) kebab++;
    else if (/^[a-z][a-zA-Z0-9]*$/.test(stem) && /[A-Z]/.test(stem)) camel++;
    else if (/^[A-Z][a-zA-Z0-9]*$/.test(stem)) pascal++;
  }

  const total = files.length;
  if (kebab / total > 0.5) {
    conventions.push({ category: 'naming', rule: 'Use kebab-case for file names', source: 'detected' });
  } else if (camel / total > 0.5) {
    conventions.push({ category: 'naming', rule: 'Use camelCase for file names', source: 'detected' });
  } else if (pascal / total > 0.5) {
    conventions.push({ category: 'naming', rule: 'Use PascalCase for file names', source: 'detected' });
  }
}

function detectLintingConfig(root: string, conventions: ProjectConvention[]): void {
  const eslintFiles = [
    '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml',
    '.eslintrc.yaml', '.eslintrc', 'eslint.config.js', 'eslint.config.mjs',
    'eslint.config.cjs', 'eslint.config.ts',
  ];
  const hasEslint = eslintFiles.some((f) => fs.existsSync(path.join(root, f)));
  if (hasEslint) {
    conventions.push({ category: 'quality', rule: 'ESLint is configured for code linting', source: 'detected' });
  }

  const prettierFiles = [
    '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs',
    '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml',
    'prettier.config.js', 'prettier.config.cjs',
  ];
  const hasPrettier = prettierFiles.some((f) => fs.existsSync(path.join(root, f)));
  if (hasPrettier) {
    conventions.push({ category: 'quality', rule: 'Prettier is configured for code formatting', source: 'detected' });
  }

  if (fs.existsSync(path.join(root, 'tsconfig.json'))) {
    conventions.push({ category: 'language', rule: 'TypeScript is used (tsconfig.json present)', source: 'detected' });
  }

  if (fs.existsSync(path.join(root, '.editorconfig'))) {
    conventions.push({ category: 'quality', rule: 'EditorConfig is configured for consistent formatting', source: 'detected' });
  }
}

function findFileMatching(dir: string, pattern: RegExp, maxDepth: number): boolean {
  if (maxDepth <= 0) return false;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isFile() && pattern.test(entry.name)) return true;
      if (entry.isDirectory() && findFileMatching(path.join(dir, entry.name), pattern, maxDepth - 1)) return true;
    }
  } catch {
    // Ignore permission errors
  }
  return false;
}

function collectFileNames(dir: string, maxDepth: number): string[] {
  const names: string[] = [];
  if (maxDepth <= 0) return names;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (entry.isFile()) names.push(entry.name);
      else if (entry.isDirectory()) names.push(...collectFileNames(path.join(dir, entry.name), maxDepth - 1));
      if (names.length > 100) break;
    }
  } catch {
    // Ignore permission errors
  }
  return names;
}
