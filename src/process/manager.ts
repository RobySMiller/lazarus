import { spawn, type ChildProcess } from 'node:child_process';

import { logger } from '../logger.js';

const GRACEFUL_TIMEOUT = 5_000;

export interface ProcessManagerOptions {
  command: string;
  role: 'primary' | 'standby' | 'active';
  autoRestart?: boolean;
  onExit?: (code: number | null, signal: string | null) => void;
}

let child: ChildProcess | null = null;
let currentOpts: ProcessManagerOptions | null = null;
let shouldRestart = false;

export function startProcess(opts: ProcessManagerOptions): void {
  if (child) {
    logger.warn('Process already running, ignoring start');
    return;
  }

  currentOpts = opts;
  shouldRestart = opts.autoRestart ?? false;

  const env = { ...process.env, LAZARUS_ROLE: opts.role };

  child = spawn(opts.command, {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      process.stdout.write(`[service] ${line}\n`);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      process.stderr.write(`[service] ${line}\n`);
    }
  });

  child.on('exit', (code, signal) => {
    logger.info({ code, signal }, 'Service process exited');
    child = null;

    // Notify caller that the process died
    if (opts.onExit) {
      opts.onExit(code, signal);
    }

    if (shouldRestart && currentOpts) {
      logger.info('Auto-restarting service...');
      setTimeout(() => startProcess(opts), 1000);
    }
  });

  logger.info({ command: opts.command, pid: child.pid, role: opts.role }, 'Service started');
}

export async function stopProcess(): Promise<void> {
  if (!child) return;

  shouldRestart = false;

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child) {
        logger.warn('Graceful shutdown timed out, sending SIGKILL');
        child.kill('SIGKILL');
      }
    }, GRACEFUL_TIMEOUT);

    child!.on('exit', () => {
      clearTimeout(timeout);
      child = null;
      resolve();
    });

    child!.kill('SIGTERM');
    logger.info('Sent SIGTERM to service');
  });
}

export function signalProcess(signal: NodeJS.Signals): void {
  if (!child) return;
  child.kill(signal);
  logger.info({ signal }, 'Sent signal to service');
}

export function isProcessRunning(): boolean {
  return child !== null;
}
