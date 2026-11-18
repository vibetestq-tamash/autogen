import { spawn, type ChildProcess } from 'node:child_process';
import type { TerminalEvent } from '@shared/types';

const running = new Map<string, ChildProcess>();
let counter = 0;

export interface RunResult {
  code: number | null;
  output: string;
}

/**
 * Runs a shell command in the project folder and streams its output.
 * The user's own Node/npm is used, so projects behave exactly as they would in a terminal.
 */
export function runCommand(
  cwd: string,
  command: string,
  onEvent: (e: TerminalEvent) => void,
  opts: { timeoutMs?: number; env?: Record<string, string> } = {}
): { id: string; done: Promise<RunResult> } {
  const id = `run_${++counter}`;
  onEvent({ type: 'start', id, command });
  const child = spawn(command, {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0', CI: '', ...opts.env }
  });
  running.set(id, child);
  let output = '';
  const onData = (buf: Buffer) => {
    const text = buf.toString();
    output += text;
    onEvent({ type: 'data', id, text });
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  const done = new Promise<RunResult>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        onData(Buffer.from(`\n[timed out after ${Math.round(opts.timeoutMs! / 1000)}s]\n`));
        killRun(id);
      }, opts.timeoutMs);
    }
    const finish = (code: number | null) => {
      if (timer) clearTimeout(timer);
      if (!running.has(id)) return;
      running.delete(id);
      onEvent({ type: 'exit', id, code });
      resolve({ code, output });
    };
    child.on('error', (err) => {
      onData(Buffer.from(`\n${err.message}\n`));
      finish(1);
    });
    child.on('close', (code) => finish(code));
  });
  return { id, done };
}

export function killRun(id: string): void {
  const child = running.get(id);
  if (!child || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
  } else {
    child.kill('SIGTERM');
  }
}

export function killAll(): void {
  for (const id of [...running.keys()]) killRun(id);
}
