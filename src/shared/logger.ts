import * as vscode from 'vscode';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private channel?: vscode.OutputChannel;
  private minLevel: LogLevel = 'info';

  /** Initialize with a VS Code OutputChannel. Call once during activation. */
  init(channel: vscode.OutputChannel): void {
    this.channel = channel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  error(message: string, errOrArgs?: unknown, ...args: unknown[]): void {
    if (errOrArgs instanceof Error) {
      this.log('error', `${message}: ${errOrArgs.message}\n${errOrArgs.stack ?? ''}`, args);
    } else {
      this.log('error', message, errOrArgs !== undefined ? [errOrArgs, ...args] : args);
    }
  }

  /** Show the output channel in the VS Code panel. */
  show(): void {
    this.channel?.show(true);
  }

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const timestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    let line = `${prefix} ${message}`;
    if (args.length > 0) {
      const formatted = args
        .map(a => {
          if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
          if (typeof a === 'object') {
            try { return JSON.stringify(a, null, 2); } catch { return String(a); }
          }
          return String(a);
        })
        .join(' ');
      line += ` ${formatted}`;
    }

    if (this.channel) {
      this.channel.appendLine(line);
    } else {
      // Fallback before init
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
}

export const logger = new Logger();
