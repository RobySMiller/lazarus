import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { startHeartbeatReceiver, stopHeartbeatReceiver, getStateMachine } from '../src/heartbeat/receiver.js';
import { stopHeartbeatSender } from '../src/heartbeat/sender.js';

function postHeartbeat(port: number, secret?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/heartbeat', method: 'POST', headers },
      (res) => resolve(res.statusCode!),
    );
    req.on('error', reject);
    req.write(JSON.stringify({ timestamp: Date.now(), hostname: 'test', pid: 1 }));
    req.end();
  });
}

function getHealth(port: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/health`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

describe('heartbeat receiver', () => {
  let server: http.Server | null = null;
  const PORT = 18901;

  afterEach(() => {
    stopHeartbeatReceiver();
    if (server) {
      server.close();
      server = null;
    }
    stopHeartbeatSender();
  });

  it('accepts heartbeats and updates state machine', async () => {
    let failoverCount = 0;
    server = startHeartbeatReceiver(
      PORT,
      { timeoutMs: 30_000, failoverThreshold: 3, recoveryThreshold: 3 },
      () => failoverCount++,
      () => {},
    );
    await new Promise((r) => setTimeout(r, 200));

    const status = await postHeartbeat(PORT);
    expect(status).toBe(200);

    const sm = getStateMachine();
    expect(sm).not.toBeNull();
    expect(sm!.lastHeartbeat).toBeGreaterThan(0);
  });

  it('health endpoint returns state machine status', async () => {
    server = startHeartbeatReceiver(
      PORT,
      { timeoutMs: 30_000, failoverThreshold: 3, recoveryThreshold: 3 },
      () => {},
      () => {},
    );
    await new Promise((r) => setTimeout(r, 200));

    const health = await getHealth(PORT);
    expect(health.status).toBe('ok');
    expect(health.state).toBe('UNKNOWN');
    expect(health.role).toBe('standby');
    expect(typeof health.uptime).toBe('number');
  });

  it('rejects heartbeats with wrong secret', async () => {
    server = startHeartbeatReceiver(
      PORT,
      { timeoutMs: 30_000, failoverThreshold: 3, recoveryThreshold: 3 },
      () => {},
      () => {},
      'correct-secret',
    );
    await new Promise((r) => setTimeout(r, 200));

    const status = await postHeartbeat(PORT, 'wrong-secret');
    expect(status).toBe(401);
  });

  it('accepts heartbeats with correct secret', async () => {
    server = startHeartbeatReceiver(
      PORT,
      { timeoutMs: 30_000, failoverThreshold: 3, recoveryThreshold: 3 },
      () => {},
      () => {},
      'my-secret',
    );
    await new Promise((r) => setTimeout(r, 200));

    const status = await postHeartbeat(PORT, 'my-secret');
    expect(status).toBe(200);
  });

  it('returns 404 for unknown routes', async () => {
    server = startHeartbeatReceiver(
      PORT,
      { timeoutMs: 30_000, failoverThreshold: 3, recoveryThreshold: 3 },
      () => {},
      () => {},
    );
    await new Promise((r) => setTimeout(r, 200));

    const status = await new Promise<number>((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}/unknown`, (res) => resolve(res.statusCode!))
        .on('error', reject);
    });
    expect(status).toBe(404);
  });
});
