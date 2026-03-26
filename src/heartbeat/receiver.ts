import http from 'node:http';

import { logger } from '../logger.js';
import type { HeartbeatStatus } from './types.js';

let lastHeartbeat = 0;
let stateCheckTimer: NodeJS.Timeout | null = null;
let wasPrimaryAlive = false;
const startTime = Date.now();

export function isPrimaryAlive(timeoutMs: number): boolean {
  return lastHeartbeat > 0 && Date.now() - lastHeartbeat < timeoutMs;
}

export function startHeartbeatReceiver(
  port: number,
  timeoutMs: number,
  onPrimaryAlive: () => void,
  onPrimaryDead: () => void,
  secret?: string,
): http.Server {
  const CHECK_INTERVAL = 5_000;

  const server = http.createServer((req, res) => {
    // POST /heartbeat — receive heartbeat from primary
    if (req.method === 'POST' && req.url === '/heartbeat') {
      if (secret) {
        const auth = req.headers['authorization'];
        if (auth !== `Bearer ${secret}`) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('unauthorized');
          return;
        }
      }

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        lastHeartbeat = Date.now();
        logger.debug('Heartbeat received');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return;
    }

    // GET /health or GET / — status endpoint
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      const status: HeartbeatStatus = {
        status: 'ok',
        primaryAlive: isPrimaryAlive(timeoutMs),
        lastHeartbeat: lastHeartbeat || null,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        role: 'standby',
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Heartbeat receiver listening');
  });

  // Poll for state transitions
  stateCheckTimer = setInterval(() => {
    const alive = isPrimaryAlive(timeoutMs);
    if (alive && !wasPrimaryAlive) {
      logger.info('Primary came online — yielding');
      wasPrimaryAlive = true;
      onPrimaryAlive();
    } else if (!alive && wasPrimaryAlive) {
      logger.info('Primary went offline — taking over');
      wasPrimaryAlive = false;
      onPrimaryDead();
    }
  }, CHECK_INTERVAL);

  return server;
}

export function stopHeartbeatReceiver(): void {
  if (stateCheckTimer) {
    clearInterval(stateCheckTimer);
    stateCheckTimer = null;
  }
}
