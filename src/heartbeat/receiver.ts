import http from 'node:http';

import { logger } from '../logger.js';
import { FailoverStateMachine, type StateMachineConfig } from '../state-machine.js';
import type { HeartbeatStatus } from './types.js';

const CHECK_INTERVAL = 5_000;
let stateCheckTimer: NodeJS.Timeout | null = null;
let stateMachine: FailoverStateMachine | null = null;
const startTime = Date.now();

export function startHeartbeatReceiver(
  port: number,
  smConfig: StateMachineConfig,
  onFailover: () => void,
  onYield: () => void,
  secret?: string,
): http.Server {
  stateMachine = new FailoverStateMachine(smConfig, onFailover, onYield);

  const server = http.createServer((req, res) => {
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
        stateMachine!.heartbeat();
        logger.debug('Heartbeat received');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      });
      return;
    }

    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      const sm = stateMachine!;
      const status: HeartbeatStatus = {
        status: 'ok',
        state: sm.state,
        primaryAlive: sm.state === 'HEALTHY' || sm.state === 'RECOVERING',
        lastHeartbeat: sm.lastHeartbeat || null,
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

  stateCheckTimer = setInterval(() => {
    const prevState = stateMachine!.state;
    stateMachine!.check();
    const newState = stateMachine!.state;
    if (prevState !== newState) {
      logger.info({ from: prevState, to: newState }, 'State transition');
    }
  }, CHECK_INTERVAL);

  return server;
}

export function getStateMachine(): FailoverStateMachine | null {
  return stateMachine;
}

export function stopHeartbeatReceiver(): void {
  if (stateCheckTimer) {
    clearInterval(stateCheckTimer);
    stateCheckTimer = null;
  }
}
