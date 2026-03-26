# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-25

### Added

- Initial release
- `lazarus primary` — run as primary, send heartbeats, manage service
- `lazarus standby` — run as standby, receive heartbeats, failover on silence
- `lazarus ping` — test heartbeat connectivity
- `lazarus status` — query standby health endpoint
- `lazarus init` — generate lazarus.yml template
- Cold and warm standby modes
- Wrap mode (process management) and hook mode (shell commands)
- Shared secret authentication on heartbeats
- Health endpoint (`GET /health`) with JSON status
- Config cascade: defaults → lazarus.yml → env vars → CLI flags
- Environment variable interpolation in YAML config
- Graceful shutdown on SIGTERM/SIGINT
