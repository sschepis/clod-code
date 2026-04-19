#!/usr/bin/env node
/**
 * Pre-package script for vsce.
 *
 * Problem: `vsce package` runs `npm list --production` which fails because
 * the `file:../oboto-agent` link pulls in oboto-agent's pnpm workspace with
 * hundreds of unresolved peer deps.
 *
 * Solution: Use `--no-dependencies` to skip that check, then manually copy
 * the runtime-required packages into dist/node_modules. Node.js resolves
 * dist/node_modules first when the entrypoint is dist/extension.js.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST_NM = path.join(ROOT, 'dist', 'node_modules');

// Packages that webpack externalises (commonjs) or that are loaded
// via dynamic import() at runtime with webpackIgnore.
const RUNTIME_DEPS = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@google-cloud/vertexai',
  '@nut-tree-fork/nut-js',
  '@aleph-ai/tinyaleph',
  '@sschepis/oboto-agent',
  '@sschepis/llm-wrapper',
  '@sschepis/swiss-army-tool',
  '@sschepis/as-agent',
  '@sschepis/lmscript',
  'web-tree-sitter',
  'zod',
];

// Directories to always skip during copy
const SKIP_DIRS = new Set([
  'node_modules', 'test', 'tests', '__tests__', '.tests',
  'docs', 'doc', 'example', 'examples', '.github', '.git',
  'src', 'scripts', 'benchmark', 'benchmarks', 'fixtures',
  'coverage', '.nyc_output', '.vscode',
]);

// File extensions to skip
const SKIP_EXTS = new Set([
  '.map', '.ts', '.tsx', '.flow', '.mts', '.cts',
]);

function shouldSkipFile(name) {
  const ext = path.extname(name);
  if (SKIP_EXTS.has(ext)) return true;
  if (name === 'CHANGELOG' || name === 'CHANGELOG.md') return true;
  if (name.startsWith('LICENSE')) return true;
  if (name.endsWith('.md') && name !== 'README.md') return true;
  if (name === '.npmignore' || name === '.eslintrc' || name === '.prettierrc') return true;
  if (name.startsWith('.eslintrc') || name.startsWith('.prettierrc')) return true;
  return false;
}

function copyRecursive(src, dest, depth = 0) {
  if (!fs.existsSync(src)) return;
  const stat = fs.lstatSync(src);

  if (stat.isSymbolicLink()) {
    copyRecursive(fs.realpathSync(src), dest, depth);
    return;
  }

  if (stat.isDirectory()) {
    const dirName = path.basename(src);
    if (SKIP_DIRS.has(dirName) && depth > 0) return;

    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), depth + 1);
    }
  } else {
    if (shouldSkipFile(path.basename(src))) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function resolvePackagePath(pkgName) {
  const nmDir = path.join(ROOT, 'node_modules', pkgName);
  if (fs.existsSync(nmDir)) {
    // Resolve symlinks (file: deps are symlinked)
    return fs.realpathSync(nmDir);
  }
  return null;
}

/**
 * Copy a package's dist/build output + package.json only.
 * Skips node_modules, src, tests, etc.
 */
function copyPackage(pkgName) {
  const srcPath = resolvePackagePath(pkgName);
  if (!srcPath) return false;

  const destPath = path.join(DIST_NM, pkgName);
  copyRecursive(srcPath, destPath);
  return true;
}

/**
 * Read a package's production dependencies and copy them too (flat into DIST_NM).
 * Only goes 2 levels deep to avoid exponential blowup.
 */
function copyTransitiveDeps(pkgName, visited = new Set()) {
  if (visited.has(pkgName)) return;
  visited.add(pkgName);

  const srcPath = resolvePackagePath(pkgName);
  if (!srcPath) return;

  let pkgJson;
  try {
    pkgJson = JSON.parse(fs.readFileSync(path.join(srcPath, 'package.json'), 'utf8'));
  } catch { return; }

  const prodDeps = Object.keys(pkgJson.dependencies || {});
  for (const subDep of prodDeps) {
    const subDest = path.join(DIST_NM, subDep);
    if (fs.existsSync(subDest)) continue;

    // Try root node_modules (flat install)
    const subSrc = resolvePackagePath(subDep);
    if (subSrc) {
      const destPath = path.join(DIST_NM, subDep);
      copyRecursive(subSrc, destPath);
      copyTransitiveDeps(subDep, visited);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────

console.log('Prepackage: copying runtime dependencies to dist/node_modules...');

if (fs.existsSync(DIST_NM)) {
  fs.rmSync(DIST_NM, { recursive: true });
}

let copied = 0;
let skipped = 0;
const visited = new Set();

for (const dep of RUNTIME_DEPS) {
  if (copyPackage(dep)) {
    copyTransitiveDeps(dep, visited);
    console.log(`  OK ${dep}`);
    copied++;
  } else {
    console.warn(`  SKIP ${dep} (not found)`);
    skipped++;
  }
}

// Report size
const sizeStr = execSync(`du -sh "${DIST_NM}" 2>/dev/null || echo "unknown"`).toString().trim();
const count = execSync(`find "${DIST_NM}" -type f 2>/dev/null | wc -l`).toString().trim();
console.log(`Prepackage: ${copied} packages copied, ${skipped} skipped`);
console.log(`Prepackage: dist/node_modules = ${sizeStr} (${count} files)`);
