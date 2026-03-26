# Lazarus

> Your service, risen.

**Your AI never sleeps, even when your laptop does.**

Close your laptop, lose WiFi, or let your Mac sleep — your AI agent, bot, or service keeps running. Lazarus is a lightweight heartbeat failover that keeps a cloud standby ready. When your local machine goes dark, the cloud takes over in 30 seconds. When you come back, it yields. Seamlessly.

Born from running AI agents locally. We got tired of our assistant going offline every time we closed a lid.

```
Your Laptop (primary)                Cloud (standby)
┌─────────────────────┐              ┌─────────────────────┐
│                     │  heartbeat   │                     │
│   Your AI agent     │──every 10s──▶│   Lazarus standby   │
│   + Lazarus primary │              │   (idle, $0 compute)│
│                     │              │                     │
└─────────────────────┘              └─────────────────────┘

        💤 laptop sleeps              30s, no heartbeat...

                                     ┌─────────────────────┐
                                     │                     │
                                     │   LAZARUS RISES     │
                                     │   Agent takes over  │
                                     │                     │
                                     └─────────────────────┘

        ☀️ laptop wakes up

┌─────────────────────┐              ┌─────────────────────┐
│                     │  heartbeat   │                     │
│   Your AI agent     │──resumes───▶│   Yields back       │
│   reclaims control  │              │   (idle again)      │
│                     │              │                     │
└─────────────────────┘              └─────────────────────┘
```

## Use cases

- **AI agents** — Run your Claude, GPT, or custom agent locally. Lazarus keeps it alive in the cloud when your machine sleeps.
- **Bots** — Slack bots, Discord bots, Telegram bots — run them on your hardware, fail over to the cloud.
- **Dev servers** — Keep a preview environment alive even when your laptop is closed.
- **Any long-running process** — Anything you want to run locally-first with cloud backup.

## Quick Start

```bash
npm i -g lazarus-failover
```

**On your local machine (primary):**
```bash
lazarus primary \
  --target https://your-cloud-standby.example.com:8089 \
  --command "node my-agent.js"
```

**On your cloud instance (standby):**
```bash
lazarus standby \
  --port 8089 \
  --command "node my-agent.js"
```

That's it. If your machine goes offline for 30 seconds, the cloud starts your service. When you come back, it stops.

## Why

You want to run things locally — it's faster, cheaper, and yours. But laptops sleep, power goes out, and WiFi drops.

Existing HA tools (Keepalived, Pacemaker, Consul) are built for data centers, not for "my Mac runs my AI agent and I want Railway as a backup."

Lazarus is one thing done well: heartbeat-based failover in ~400 lines of TypeScript.

## How it works

1. **Primary** sends an HTTP heartbeat to the standby every 10 seconds
2. **Standby** listens. As long as heartbeats arrive, it stays idle
3. If **30 seconds** pass with no heartbeat, the standby starts your service
4. When the primary comes back and heartbeats resume, the standby stops the service and yields

No leader election. No consensus protocol. No distributed state. Just a deadman's switch.

## Configuration

Lazarus loads config from (later wins):

1. Built-in defaults
2. `lazarus.yml` in the current directory
3. `LAZARUS_*` environment variables
4. CLI flags

### Config file

```yaml
# lazarus.yml
role: primary

heartbeat:
  interval: 10000          # ms between heartbeats
  timeout: 30000           # ms before primary is declared dead
  port: 8089               # standby listens on this port
  target: "https://standby.example.com"

service:
  command: "node server.js"

standby:
  mode: cold               # "cold" or "warm"

secret: "${LAZARUS_SECRET}" # env var interpolation
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `LAZARUS_ROLE` | `primary` or `standby` |
| `LAZARUS_HEARTBEAT_TARGET` | URL to send heartbeats to |
| `LAZARUS_HEARTBEAT_INTERVAL` | Heartbeat interval in ms |
| `LAZARUS_HEARTBEAT_TIMEOUT` | Timeout before failover in ms |
| `LAZARUS_HEARTBEAT_PORT` | Port standby listens on |
| `LAZARUS_SECRET` | Shared secret for auth |
| `LAZARUS_COMMAND` | Service command to wrap |
| `LAZARUS_LOG_LEVEL` | `debug`, `info`, `warn`, `error` |

## Modes

### Wrap mode (default)

Lazarus manages your service process. In standby mode, it starts the process when the primary dies and stops it when the primary returns.

```bash
lazarus standby --command "python app.py" --port 8089
```

### Hook mode

For when you manage processes yourself (systemd, Docker, PM2). Lazarus just fires shell commands on state transitions.

```yaml
service:
  hooks:
    on_primary_down: "systemctl start myapp"
    on_primary_up: "systemctl stop myapp"
```

### Cold standby (default)

Service is not running until failover. Uses zero resources until needed.

### Warm standby

Service is always running but knows its role via the `LAZARUS_ROLE` environment variable (`standby` or `active`). On failover, Lazarus sends a configurable signal (default: `SIGHUP`) so your service can start accepting traffic.

```yaml
standby:
  mode: warm
  signal: SIGHUP
```

## Security

### Shared secret

Set `LAZARUS_SECRET` on both primary and standby. The primary includes it as a Bearer token in heartbeat requests. The standby validates it.

```bash
# Both machines
export LAZARUS_SECRET=my-secret-token
```

Without a secret, any POST to `/heartbeat` is accepted. Fine for private networks; use a secret for public endpoints.

## Commands

```bash
lazarus primary [options]   # Run as primary
lazarus standby [options]   # Run as standby
lazarus ping --target URL   # Test heartbeat connectivity
lazarus status --target URL # Query standby health
lazarus init                # Generate lazarus.yml template
```

## Health endpoint

The standby exposes a health endpoint:

```bash
curl https://standby.example.com:8089/health
```

```json
{
  "status": "ok",
  "primaryAlive": true,
  "lastHeartbeat": 1711324567890,
  "uptime": 3600,
  "role": "standby"
}
```

## Deploy the standby anywhere

### Railway

```bash
lazarus standby --port $PORT --command "node server.js"
```

### Fly.io

```bash
lazarus standby --port 8080 --command "./my-service"
```

### Any VPS

```bash
lazarus standby --port 8089 --command "docker start myapp"
```

### Docker Compose

```yaml
services:
  standby:
    image: node:20
    command: npx lazarus-failover standby --port 8089 --command "node server.js"
    ports:
      - "8089:8089"
    environment:
      - LAZARUS_SECRET=${LAZARUS_SECRET}
```

## Limitations

- **Single standby.** v1 supports one primary and one standby. Multi-standby would require leader election — a different tool.
- **No state replication.** Lazarus coordinates processes, not data. Use a shared database, S3, or mounted volume for state.
- **Brief split-brain window.** When the primary returns, there's a ~5 second window where both could be running. Design your service to be idempotent.

## License

MIT
