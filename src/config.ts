import fs from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

export interface LazarusConfig {
  role: 'primary' | 'standby';
  heartbeat: {
    interval: number;
    timeout: number;
    port: number;
    target?: string;
  };
  service?: {
    command?: string;
    hooks?: {
      on_primary_down?: string;
      on_primary_up?: string;
    };
  };
  standby: {
    mode: 'cold' | 'warm';
    signal: string;
  };
  secret?: string;
  logLevel: string;
}

const DEFAULTS: LazarusConfig = {
  role: 'standby',
  heartbeat: {
    interval: 10_000,
    timeout: 30_000,
    port: 8089,
  },
  service: undefined,
  standby: {
    mode: 'cold',
    signal: 'SIGHUP',
  },
  logLevel: 'info',
};

function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
}

function deepInterpolate(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(deepInterpolate);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepInterpolate(v);
    }
    return result;
  }
  return obj;
}

export function loadConfig(
  configPath?: string,
  cliOverrides?: Partial<{
    role: string;
    target: string;
    port: number;
    interval: number;
    timeout: number;
    secret: string;
    command: string;
    onPrimaryDown: string;
    onPrimaryUp: string;
    logLevel: string;
    standbyMode: string;
  }>,
): LazarusConfig {
  // Start with defaults
  const config: LazarusConfig = structuredClone(DEFAULTS);

  // Layer 2: YAML file
  const yamlPath = configPath || path.resolve('lazarus.yml');
  if (fs.existsSync(yamlPath)) {
    const raw = fs.readFileSync(yamlPath, 'utf-8');
    const parsed = deepInterpolate(YAML.parse(raw)) as Record<string, unknown>;
    mergeYaml(config, parsed);
  }

  // Layer 3: Environment variables
  if (process.env.LAZARUS_ROLE) config.role = process.env.LAZARUS_ROLE as 'primary' | 'standby';
  if (process.env.LAZARUS_HEARTBEAT_INTERVAL) config.heartbeat.interval = parseInt(process.env.LAZARUS_HEARTBEAT_INTERVAL, 10);
  if (process.env.LAZARUS_HEARTBEAT_TIMEOUT) config.heartbeat.timeout = parseInt(process.env.LAZARUS_HEARTBEAT_TIMEOUT, 10);
  if (process.env.LAZARUS_HEARTBEAT_PORT) config.heartbeat.port = parseInt(process.env.LAZARUS_HEARTBEAT_PORT, 10);
  if (process.env.LAZARUS_HEARTBEAT_TARGET) config.heartbeat.target = process.env.LAZARUS_HEARTBEAT_TARGET;
  if (process.env.LAZARUS_SECRET) config.secret = process.env.LAZARUS_SECRET;
  if (process.env.LAZARUS_COMMAND) {
    config.service = config.service || {};
    config.service.command = process.env.LAZARUS_COMMAND;
  }
  if (process.env.LAZARUS_LOG_LEVEL) config.logLevel = process.env.LAZARUS_LOG_LEVEL;

  // Layer 4: CLI overrides
  if (cliOverrides) {
    if (cliOverrides.role) config.role = cliOverrides.role as 'primary' | 'standby';
    if (cliOverrides.target) config.heartbeat.target = cliOverrides.target;
    if (cliOverrides.port) config.heartbeat.port = cliOverrides.port;
    if (cliOverrides.interval) config.heartbeat.interval = cliOverrides.interval;
    if (cliOverrides.timeout) config.heartbeat.timeout = cliOverrides.timeout;
    if (cliOverrides.secret) config.secret = cliOverrides.secret;
    if (cliOverrides.logLevel) config.logLevel = cliOverrides.logLevel;
    if (cliOverrides.standbyMode) config.standby.mode = cliOverrides.standbyMode as 'cold' | 'warm';
    if (cliOverrides.command) {
      config.service = config.service || {};
      config.service.command = cliOverrides.command;
    }
    if (cliOverrides.onPrimaryDown || cliOverrides.onPrimaryUp) {
      config.service = config.service || {};
      config.service.hooks = config.service.hooks || {};
      if (cliOverrides.onPrimaryDown) config.service.hooks.on_primary_down = cliOverrides.onPrimaryDown;
      if (cliOverrides.onPrimaryUp) config.service.hooks.on_primary_up = cliOverrides.onPrimaryUp;
    }
  }

  // Validation
  if (config.role === 'primary' && !config.heartbeat.target) {
    throw new Error('Primary mode requires a heartbeat target URL (--target or heartbeat.target in config)');
  }
  if (config.service?.command && config.service?.hooks) {
    throw new Error('Cannot specify both service.command and service.hooks — pick one');
  }

  return config;
}

function mergeYaml(config: LazarusConfig, parsed: Record<string, unknown>): void {
  if (parsed.role) config.role = parsed.role as 'primary' | 'standby';
  if (parsed.secret) config.secret = parsed.secret as string;
  if (parsed.log_level) config.logLevel = parsed.log_level as string;

  const hb = parsed.heartbeat as Record<string, unknown> | undefined;
  if (hb) {
    if (hb.interval) config.heartbeat.interval = hb.interval as number;
    if (hb.timeout) config.heartbeat.timeout = hb.timeout as number;
    if (hb.port) config.heartbeat.port = hb.port as number;
    if (hb.target) config.heartbeat.target = hb.target as string;
  }

  const svc = parsed.service as Record<string, unknown> | undefined;
  if (svc) {
    config.service = config.service || {};
    if (svc.command) config.service.command = svc.command as string;
    const hooks = svc.hooks as Record<string, string> | undefined;
    if (hooks) {
      config.service.hooks = {
        on_primary_down: hooks.on_primary_down,
        on_primary_up: hooks.on_primary_up,
      };
    }
  }

  const sb = parsed.standby as Record<string, unknown> | undefined;
  if (sb) {
    if (sb.mode) config.standby.mode = sb.mode as 'cold' | 'warm';
    if (sb.signal) config.standby.signal = sb.signal as string;
  }
}
