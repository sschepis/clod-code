const fs = require('fs');
const path = './src/shared/window-id.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /export function isAlive\(pid: number\): boolean \{\s*try \{\s*process\.kill\(pid, 0\);\s*return true;\s*\} catch \{\s*return false;\s*\}\s*\}/,
  `export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e.code === 'EPERM') return true;
    return false;
  }
}`
);

fs.writeFileSync(path, code);
