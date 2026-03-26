import { exec } from 'node:child_process';
import { logger } from './logger.js';

export interface HealthCheckConfig {
  url?: string;
  command?: string;
  interval: number;
  timeout: number;
  unhealthyThreshold: number;
}

let checkTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;
let isHealthy = true;

export function startHealthCheck(
  config: HealthCheckConfig,
  onUnhealthy: () => void,
  onHealthy: () => void,
): void {
  const runCheck = async () => {
    try {
      if (config.url) {
        const res = await fetch(config.url, {
          signal: AbortSignal.timeout(config.timeout),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else if (config.command) {
        await runCommand(config.command, config.timeout);
      }

      // Check passed
      if (!isHealthy) {
        consecutiveFailures = 0;
        isHealthy = true;
        logger.info('Health check passed — service healthy');
        onHealthy();
      } else {
        consecutiveFailures = 0;
      }
    } catch (err) {
      consecutiveFailures++;
      logger.warn(
        { failures: consecutiveFailures, threshold: config.unhealthyThreshold },
        'Health check failed',
      );
      if (consecutiveFailures >= config.unhealthyThreshold && isHealthy) {
        isHealthy = false;
        logger.error('Service unhealthy — stopping heartbeats');
        onUnhealthy();
      }
    }
  };

  checkTimer = setInterval(runCheck, config.interval);
  // Delay first check to let the service start
  setTimeout(runCheck, Math.min(config.interval, 5000));
  logger.info({ url: config.url, command: config.command, interval: config.interval }, 'Health check started');
}

export function stopHealthCheck(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  consecutiveFailures = 0;
  isHealthy = true;
}

export function isServiceHealthy(): boolean {
  return isHealthy;
}

function runCommand(cmd: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { timeout });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`exit code ${code}`));
    });
    child.on('error', reject);
  });
}
