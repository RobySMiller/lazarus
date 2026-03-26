import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { startHeartbeatReceiver, stopHeartbeatReceiver, isPrimaryAlive } from '../src/heartbeat/receiver.js';
import { startHeartbeatSender, stopHeartbeatSender } from '../src/heartbeat/sender.js';

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

function getHealth(port: number): Promise<{ status: string; primaryAlive: boolean }> {
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

  it('accepts heartbeats and reports primary alive', async () => {
    let aliveCount = 0;
    let deadCount = 0;

    server = startHeartbeatReceiver(
      PORT,
      30_000,
      () => aliveCount++,
      () => deadCount++,
    );

    await new Promise((r) => setTimeout(r, 200));

    const status = await postHeartbeat(PORT);
    expect(status).toBe(200);

    expect(isPrimaryAlive(30_000)).toBe(true);
  });

  it('health endpoint returns JSON status', async () => {
    server = startHeartbeatReceiver(PORT, 30_000, () => {}, () => {});
    await new Promise((r) => setTimeout(r, 200));

    const health = await getHealth(PORT);
    expect(health.status).toBe('ok');
    expect(typeof health.primaryAlive).toBe('boolean');
  });

  it('rejects heartbeats with wrong secret', async () => {
    server = startHeartbeatReceiver(PORT, 30_000, () => {}, () => {}, 'correct-secret');
    await new Promise((r) => setTimeout(r, 200));

    const status = await postHeartbeat(PORT, 'wrong-secret');
    expect(status).toBe(401);
  });

  it('accepts heartbeats with correct secret', async () => {
    server = startHeartbeatReceiver(PORT, 30_000, () => {}, () => {}, 'my-secret');
    await new Promise((r) => setTimeout(r, 200));

    const status = await postHeartbeat(PORT, 'my-secret');
    expect(status).toBe(200);
    expect(isPrimaryAlive(30_000)).toBe(true);
  });

  it('reports primary dead when heartbeat exceeds timeout', async () => {
    // Use a 1ms timeout — any prior heartbeat will be expired
    await new Promise((r) => setTimeout(r, 5));
    expect(isPrimaryAlive(1)).toBe(false);
  });
});
