import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

export interface CodeRunDeps {
  pushToSurface?: (name: string, channel: string, data: unknown) => boolean;
}

const LANG_CMD: Record<string, string> = {
  python: 'python3',
  python3: 'python3',
  javascript: 'node',
  js: 'node',
  node: 'node',
  bash: 'bash',
  sh: 'sh',
};

const LANG_EXT: Record<string, string> = {
  python: '.py',
  python3: '.py',
  javascript: '.js',
  js: '.js',
  node: '.js',
  bash: '.sh',
  sh: '.sh',
};

function detectLanguage(code: string): string {
  if (/^#!/.test(code)) return 'bash';
  if (/\bdef\s+\w+|import\s+\w+|from\s+\w+\s+import|print\s*\(/.test(code)) return 'python';
  return 'javascript';
}

export function createCodeRunHandler(deps: CodeRunDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const code = String(kwargs.code || '').trim();
    if (!code) return '[ERROR] Missing required argument: code';

    const langInput = String(kwargs.language || '').trim().toLowerCase();
    const language = langInput || detectLanguage(code);
    const cmd = LANG_CMD[language];
    if (!cmd) return `[ERROR] Unsupported language: "${language}". Supported: ${Object.keys(LANG_CMD).join(', ')}`;

    const ext = LANG_EXT[language] || '.txt';
    const tmpFile = path.join(os.tmpdir(), `obotovs-exec-${Date.now()}${ext}`);
    const timeoutMs = typeof kwargs.timeout === 'number' ? kwargs.timeout : 30000;
    const surfaceName = typeof kwargs.surface === 'string' ? kwargs.surface : undefined;
    const channel = typeof kwargs.channel === 'string' ? kwargs.channel : 'code-output';

    try {
      fs.writeFileSync(tmpFile, code);

      const start = Date.now();
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
        const proc = exec(`${cmd} "${tmpFile}"`, {
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
        }, (err, stdout, stderr) => {
          resolve({
            stdout: stdout ?? '',
            stderr: stderr ?? '',
            exitCode: err?.code ?? (err ? 1 : 0),
          });
        });

        if (surfaceName && deps.pushToSurface) {
          proc.stdout?.on('data', (chunk: string) => {
            deps.pushToSurface!(surfaceName, channel, { type: 'stdout', text: chunk });
          });
          proc.stderr?.on('data', (chunk: string) => {
            deps.pushToSurface!(surfaceName, channel, { type: 'stderr', text: chunk });
          });
        }
      });

      const durationMs = Date.now() - start;

      if (surfaceName && deps.pushToSurface) {
        deps.pushToSurface(surfaceName, channel, {
          type: 'done',
          exitCode: result.exitCode,
          durationMs,
        });
      }

      const parts = [`[${result.exitCode === 0 ? 'SUCCESS' : 'ERROR'}] Executed ${language} (${durationMs}ms, exit ${result.exitCode})`];
      if (result.stdout) parts.push(`STDOUT:\n${result.stdout.slice(0, 4096)}`);
      if (result.stderr) parts.push(`STDERR:\n${result.stderr.slice(0, 2048)}`);
      return parts.join('\n\n');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  };
}
