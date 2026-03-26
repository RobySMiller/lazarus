import { exec } from 'node:child_process';

import { logger } from './logger.js';

const HOOK_TIMEOUT = 30_000;

export async function runHook(name: string, command: string, event: string): Promise<void> {
  if (!command) return;

  logger.info({ hook: name, command }, 'Running hook');

  return new Promise<void>((resolve) => {
    const child = exec(command, {
      timeout: HOOK_TIMEOUT,
      env: { ...process.env, LAZARUS_EVENT: event },
    });

    child.stdout?.on('data', (data: string) => {
      process.stdout.write(`[hook:${name}] ${data}`);
    });

    child.stderr?.on('data', (data: string) => {
      process.stderr.write(`[hook:${name}] ${data}`);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        logger.warn({ hook: name, code }, 'Hook exited with non-zero code');
      }
      resolve();
    });

    child.on('error', (err) => {
      logger.error({ hook: name, err }, 'Hook execution failed');
      resolve();
    });
  });
}
