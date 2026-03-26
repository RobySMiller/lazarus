import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const TEST_DIR = path.resolve('test-tmp');
const TEST_CONFIG = path.join(TEST_DIR, 'lazarus.yml');

describe('loadConfig', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.LAZARUS_ROLE;
    delete process.env.LAZARUS_HEARTBEAT_TARGET;
    delete process.env.LAZARUS_HEARTBEAT_INTERVAL;
    delete process.env.LAZARUS_SECRET;
    delete process.env.LAZARUS_COMMAND;
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(path.join(TEST_DIR, 'nonexistent.yml'), {
      role: 'standby',
    });
    expect(config.role).toBe('standby');
    expect(config.heartbeat.interval).toBe(10_000);
    expect(config.heartbeat.timeout).toBe(30_000);
    expect(config.heartbeat.port).toBe(8089);
    expect(config.heartbeat.failoverThreshold).toBe(3);
    expect(config.heartbeat.recoveryThreshold).toBe(3);
    expect(config.standby.mode).toBe('cold');
  });

  it('loads from YAML file', () => {
    fs.writeFileSync(TEST_CONFIG, `
role: primary
heartbeat:
  interval: 5000
  timeout: 15000
  target: "https://example.com"
  failoverThreshold: 5
  recoveryThreshold: 5
`);
    const config = loadConfig(TEST_CONFIG);
    expect(config.role).toBe('primary');
    expect(config.heartbeat.interval).toBe(5000);
    expect(config.heartbeat.timeout).toBe(15000);
    expect(config.heartbeat.target).toBe('https://example.com');
    expect(config.heartbeat.failoverThreshold).toBe(5);
    expect(config.heartbeat.recoveryThreshold).toBe(5);
  });

  it('env vars override YAML', () => {
    fs.writeFileSync(TEST_CONFIG, `
role: standby
heartbeat:
  interval: 5000
`);
    process.env.LAZARUS_ROLE = 'primary';
    process.env.LAZARUS_HEARTBEAT_INTERVAL = '2000';
    process.env.LAZARUS_HEARTBEAT_TARGET = 'https://env.example.com';

    const config = loadConfig(TEST_CONFIG);
    expect(config.role).toBe('primary');
    expect(config.heartbeat.interval).toBe(2000);
    expect(config.heartbeat.target).toBe('https://env.example.com');
  });

  it('CLI overrides take highest priority', () => {
    process.env.LAZARUS_HEARTBEAT_TARGET = 'https://env.example.com';

    const config = loadConfig(path.join(TEST_DIR, 'nonexistent.yml'), {
      role: 'primary',
      target: 'https://cli.example.com',
      interval: 1000,
    });
    expect(config.heartbeat.target).toBe('https://cli.example.com');
    expect(config.heartbeat.interval).toBe(1000);
  });

  it('throws when primary has no target', () => {
    expect(() => loadConfig(path.join(TEST_DIR, 'nonexistent.yml'), {
      role: 'primary',
    })).toThrow('Primary mode requires a heartbeat target URL');
  });

  it('interpolates env vars in YAML', () => {
    process.env.LAZARUS_SECRET = 'my-secret-123';
    fs.writeFileSync(TEST_CONFIG, `
role: standby
secret: "\${LAZARUS_SECRET}"
`);
    const config = loadConfig(TEST_CONFIG, { role: 'standby' });
    expect(config.secret).toBe('my-secret-123');
  });

  it('loads hooks from YAML', () => {
    fs.writeFileSync(TEST_CONFIG, `
role: standby
service:
  hooks:
    on_primary_down: "echo down"
    on_primary_up: "echo up"
`);
    const config = loadConfig(TEST_CONFIG, { role: 'standby' });
    expect(config.service?.hooks?.on_primary_down).toBe('echo down');
    expect(config.service?.hooks?.on_primary_up).toBe('echo up');
  });

  it('loads healthcheck from YAML', () => {
    fs.writeFileSync(TEST_CONFIG, `
role: primary
heartbeat:
  target: "https://example.com"
service:
  command: "node app.js"
  healthcheck:
    url: "http://localhost:3000/health"
    interval: 10000
    timeout: 3000
    unhealthyThreshold: 5
`);
    const config = loadConfig(TEST_CONFIG);
    expect(config.service?.healthcheck?.url).toBe('http://localhost:3000/health');
    expect(config.service?.healthcheck?.interval).toBe(10000);
    expect(config.service?.healthcheck?.timeout).toBe(3000);
    expect(config.service?.healthcheck?.unhealthyThreshold).toBe(5);
  });

  it('supports warm standby mode', () => {
    fs.writeFileSync(TEST_CONFIG, `
role: standby
standby:
  mode: warm
`);
    const config = loadConfig(TEST_CONFIG, { role: 'standby' });
    expect(config.standby.mode).toBe('warm');
  });
});
