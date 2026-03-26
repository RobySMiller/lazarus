import os from 'node:os';

import { logger } from '../logger.js';
import type { HeartbeatPayload } from './types.js';

let heartbeatTimer: NodeJS.Timeout | null = null;
let isPaused = false;

export function startHeartbeatSender(
  targetUrl: string,
  intervalMs: number,
  secret?: string,
  isHealthy?: () => boolean,
): void {
  const send = async () => {
    // Gate on health: skip heartbeat if service is unhealthy
    if (isPaused) return;
    if (isHealthy && !isHealthy()) {
      logger.debug('Skipping heartbeat — service unhealthy');
      return;
    }

    try {
      const url = new URL('/heartbeat', targetUrl);
      const payload: HeartbeatPayload = {
        timestamp: Date.now(),
        hostname: os.hostname(),
        pid: process.pid,
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }
      await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      logger.debug({ target: targetUrl }, 'Heartbeat sent');
    } catch {
      logger.debug({ target: targetUrl }, 'Heartbeat send failed (standby may be down)');
    }
  };

  heartbeatTimer = setInterval(send, intervalMs);
  send();
  logger.info({ targetUrl, intervalMs }, 'Heartbeat sender started');
}

export function pauseHeartbeats(): void {
  isPaused = true;
  logger.warn('Heartbeats paused');
}

export function resumeHeartbeats(): void {
  isPaused = false;
  logger.info('Heartbeats resumed');
}

export function stopHeartbeatSender(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  isPaused = false;
}
