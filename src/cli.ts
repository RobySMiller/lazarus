import { parseArgs } from 'node:util';

import { loadConfig } from './config.js';
import { startHeartbeatSender, stopHeartbeatSender, pauseHeartbeats, resumeHeartbeats } from './heartbeat/sender.js';
import { startHeartbeatReceiver, stopHeartbeatReceiver } from './heartbeat/receiver.js';
import { startProcess, stopProcess, signalProcess, isProcessRunning } from './process/manager.js';
import { startHealthCheck, stopHealthCheck, isServiceHealthy } from './health-check.js';
import { runHook } from './hooks.js';
import { logger } from './logger.js';

const HELP = `
lazarus — Your service, risen.

Lightweight heartbeat failover for hybrid local/cloud operation.

USAGE:
  lazarus <command> [options]

COMMANDS:
  primary     Run as primary (send heartbeats, run service)
  standby     Run as standby (receive heartbeats, failover when primary dies)
  ping        Send a single heartbeat to test connectivity
  status      Query a standby's /health endpoint
  init        Generate a lazarus.yml template

OPTIONS:
  --config, -c <path>      Path to config file (default: ./lazarus.yml)
  --target, -t <url>       Heartbeat target URL (primary mode)
  --port, -p <port>        Listen port (standby mode)
  --interval <ms>          Heartbeat interval in ms (default: 10000)
  --timeout <ms>           Heartbeat timeout in ms (default: 30000)
  --secret <token>         Shared secret for auth
  --command <cmd>          Service command to wrap
  --on-primary-down <cmd>  Hook: primary went offline
  --on-primary-up <cmd>    Hook: primary came back
  --standby-mode <mode>    cold or warm (default: cold)
  --log-level <level>      debug, info, warn, error
  --version, -v            Print version
  --help, -h               Show help

EXAMPLES:
  # Local machine (primary)
  lazarus primary --target https://standby.example.com --command "node server.js"

  # Cloud instance (standby)
  lazarus standby --port 8089 --command "node server.js"

  # Test connectivity
  lazarus ping --target https://standby.example.com

  # Check standby status
  lazarus status --target https://standby.example.com
`;

export async function run(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      target: { type: 'string', short: 't' },
      port: { type: 'string', short: 'p' },
      interval: { type: 'string' },
      timeout: { type: 'string' },
      secret: { type: 'string' },
      command: { type: 'string' },
      'on-primary-down': { type: 'string' },
      'on-primary-up': { type: 'string' },
      'standby-mode': { type: 'string' },
      'log-level': { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    console.log(`lazarus ${pkg.version}`);
    return;
  }

  const command = positionals[0];

  if (!command) {
    console.log(HELP);
    return;
  }

  const cliOverrides = {
    role: command === 'primary' || command === 'standby' ? command : undefined,
    target: values.target,
    port: values.port ? parseInt(values.port, 10) : undefined,
    interval: values.interval ? parseInt(values.interval, 10) : undefined,
    timeout: values.timeout ? parseInt(values.timeout, 10) : undefined,
    secret: values.secret,
    command: values.command,
    onPrimaryDown: values['on-primary-down'],
    onPrimaryUp: values['on-primary-up'],
    standbyMode: values['standby-mode'],
    logLevel: values['log-level'],
  };

  switch (command) {
    case 'primary':
      return runPrimary(values.config, cliOverrides);
    case 'standby':
      return runStandby(values.config, cliOverrides);
    case 'ping':
      return runPing(values.target || process.env.LAZARUS_HEARTBEAT_TARGET, values.secret);
    case 'status':
      return runStatus(values.target || process.env.LAZARUS_HEARTBEAT_TARGET);
    case 'init':
      return runInit();
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

async function runPrimary(configPath?: string, overrides?: Record<string, unknown>): Promise<void> {
  const config = loadConfig(configPath, overrides as Parameters<typeof loadConfig>[1]);

  logger.info({
    target: config.heartbeat.target,
    interval: config.heartbeat.interval,
  }, 'Starting as PRIMARY');

  let serviceRunning = true;

  // Start the service if configured
  if (config.service?.command) {
    startProcess({
      command: config.service.command,
      role: 'primary',
      autoRestart: true,
      onExit: (code, signal) => {
        // Service crashed — pause heartbeats so standby takes over
        serviceRunning = false;
        logger.warn({ code, signal }, 'Service exited — pausing heartbeats');
        pauseHeartbeats();
      },
    });
  }

  // Health check gates heartbeats on service liveness beyond just "is the process running"
  if (config.service?.healthcheck) {
    startHealthCheck(
      config.service.healthcheck,
      () => pauseHeartbeats(),   // unhealthy → stop heartbeating
      () => resumeHeartbeats(),  // healthy again → resume
    );
  }

  // Start sending heartbeats, gated on service health
  const healthGate = config.service?.command
    ? () => serviceRunning && (!config.service?.healthcheck || isServiceHealthy())
    : undefined;

  startHeartbeatSender(config.heartbeat.target!, config.heartbeat.interval, config.secret, healthGate);

  // Track restarts — resume heartbeats when service is back
  if (config.service?.command) {
    const origOnExit = config.service.command;
    // Patch: when auto-restart brings process back, resume heartbeats
    const checkRestart = setInterval(() => {
      if (!serviceRunning && isProcessRunning()) {
        serviceRunning = true;
        logger.info('Service restarted — resuming heartbeats');
        resumeHeartbeats();
      }
    }, 1000);

    process.on('exit', () => clearInterval(checkRestart));
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopHeartbeatSender();
    stopHealthCheck();
    await stopProcess();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function runStandby(configPath?: string, overrides?: Record<string, unknown>): Promise<void> {
  const config = loadConfig(configPath, overrides as Parameters<typeof loadConfig>[1]);

  logger.info({
    port: config.heartbeat.port,
    timeout: config.heartbeat.timeout,
    mode: config.standby.mode,
    failoverThreshold: config.heartbeat.failoverThreshold,
    recoveryThreshold: config.heartbeat.recoveryThreshold,
  }, 'Starting as STANDBY');

  // Warm standby: start process immediately in standby role
  if (config.standby.mode === 'warm' && config.service?.command) {
    startProcess({
      command: config.service.command,
      role: 'standby',
      autoRestart: true,
    });
  }

  const handleFailover = async () => {
    logger.warn('PRIMARY IS DOWN — LAZARUS RISES');

    if (config.service?.command) {
      if (config.standby.mode === 'cold') {
        startProcess({ command: config.service.command, role: 'active', autoRestart: true });
      } else {
        // Warm: promote — SIGUSR1 means "you're active now"
        signalProcess('SIGUSR1');
      }
    }

    if (config.service?.hooks?.on_primary_down) {
      await runHook('on_primary_down', config.service.hooks.on_primary_down, 'primary_down');
    }
  };

  const handleYield = async () => {
    logger.info('Primary is stable — yielding');

    if (config.service?.command) {
      if (config.standby.mode === 'cold') {
        await stopProcess();
      } else {
        // Warm: demote — SIGUSR2 means "yield back to standby"
        signalProcess('SIGUSR2');
      }
    }

    if (config.service?.hooks?.on_primary_up) {
      await runHook('on_primary_up', config.service.hooks.on_primary_up, 'primary_up');
    }
  };

  const server = startHeartbeatReceiver(
    config.heartbeat.port,
    {
      timeoutMs: config.heartbeat.timeout,
      failoverThreshold: config.heartbeat.failoverThreshold,
      recoveryThreshold: config.heartbeat.recoveryThreshold,
    },
    handleFailover,
    handleYield,
    config.secret,
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopHeartbeatReceiver();
    server.close();
    await stopProcess();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

async function runPing(target?: string, secret?: string): Promise<void> {
  if (!target) {
    console.error('Error: --target is required for ping');
    process.exit(1);
  }

  try {
    const url = new URL('/heartbeat', target);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ timestamp: Date.now(), hostname: 'ping', pid: process.pid }),
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      console.log(`Heartbeat sent successfully to ${target}`);
    } else {
      console.error(`Heartbeat failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Could not reach standby at ${target}:`, (err as Error).message);
    process.exit(1);
  }
}

async function runStatus(target?: string): Promise<void> {
  if (!target) {
    console.error('Error: --target is required for status');
    process.exit(1);
  }

  try {
    const url = new URL('/health', target);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Could not reach standby at ${target}:`, (err as Error).message);
    process.exit(1);
  }
}

async function runInit(): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const dest = path.resolve('lazarus.yml');
  if (fs.existsSync(dest)) {
    console.error('lazarus.yml already exists in this directory');
    process.exit(1);
  }

  const template = `# lazarus.yml — Your service, risen.
# See https://github.com/RobySMiller/lazarus for docs.

role: standby              # "primary" or "standby"

heartbeat:
  interval: 10000          # ms between heartbeats (primary sends)
  timeout: 30000           # ms before primary is considered dead
  port: 8089               # port standby listens on
  failoverThreshold: 3     # consecutive missed checks before failover
  recoveryThreshold: 3     # consecutive alive checks before yielding back
  # target: "https://standby.example.com"  # URL primary sends heartbeats to

service:
  command: "node server.js" # Lazarus manages this process

  # Optional health check — heartbeats stop if this fails
  # healthcheck:
  #   url: "http://localhost:3000/health"  # or use command: "curl -f ..."
  #   interval: 15000
  #   timeout: 5000
  #   unhealthyThreshold: 3

  # OR use hooks instead of command:
  # hooks:
  #   on_primary_down: "systemctl start myapp"
  #   on_primary_up: "systemctl stop myapp"

standby:
  mode: cold               # "cold" (start on failover) or "warm" (always running)

# secret: "\${LAZARUS_SECRET}"  # shared secret for auth (env var interpolation)
# log_level: info
`;

  fs.writeFileSync(dest, template);
  console.log('Created lazarus.yml');
}
