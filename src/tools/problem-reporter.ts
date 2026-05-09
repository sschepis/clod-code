import * as vscode from 'vscode';
import type { Middleware, ExecutionContext } from '@sschepis/swiss-army-tool';

export class ToolProblemReporter implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;
  private errorCount = 0;

  constructor() {
    this.channel = vscode.window.createOutputChannel('Oboto Tool Errors');
  }

  reportError(command: string, error: string, kwargs?: Record<string, unknown>): void {
    this.errorCount++;
    const timestamp = new Date().toISOString();
    const argsStr = kwargs ? this.formatKwargs(kwargs) : '';

    this.channel.appendLine(`[${timestamp}] ERROR #${this.errorCount}`);
    this.channel.appendLine(`  Command: ${command}`);
    if (argsStr) {
      this.channel.appendLine(`  Args:    ${argsStr}`);
    }
    this.channel.appendLine(`  Error:   ${error}`);
    this.channel.appendLine('');
  }

  reportException(command: string, err: unknown, kwargs?: Record<string, unknown>): void {
    const message = err instanceof Error
      ? `${err.message}\n  Stack:   ${err.stack?.split('\n').slice(1, 4).join('\n           ') ?? '(no stack)'}`
      : String(err);
    this.reportError(command, `[EXCEPTION] ${message}`, kwargs);
  }

  createMiddleware(): Middleware {
    return async (ctx: ExecutionContext, next: () => Promise<string>): Promise<string> => {
      let result: string;
      try {
        result = await next();
      } catch (err) {
        this.reportException(ctx.command, err, ctx.kwargs);
        throw err;
      }

      if (typeof result === 'string' && result.startsWith('[ERROR]')) {
        this.reportError(ctx.command, result, ctx.kwargs);
      }

      return result;
    };
  }

  show(): void {
    this.channel.show(true);
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  dispose(): void {
    this.channel.dispose();
  }

  private formatKwargs(kwargs: Record<string, unknown>): string {
    const entries = Object.entries(kwargs);
    if (entries.length === 0) return '';

    const parts = entries.map(([k, v]) => {
      if (typeof v === 'string' && v.length > 120) {
        return `${k}: "${v.slice(0, 120)}..."`;
      }
      try {
        return `${k}: ${JSON.stringify(v)}`;
      } catch {
        return `${k}: [unserializable]`;
      }
    });

    const oneLiner = parts.join(', ');
    if (oneLiner.length <= 200) return oneLiner;
    return '\n    ' + parts.join('\n    ');
  }
}
