# Contributing to Lazarus

Thanks for your interest in contributing. Lazarus is intentionally small (~400 lines of TypeScript) and we'd like to keep it that way.

## Ground rules

- **Keep it small.** Lazarus does one thing: heartbeat-based failover. If your feature doesn't directly serve that, it probably belongs in a separate tool.
- **No heavy dependencies.** We have three runtime dependencies (pino, pino-pretty, yaml). Think hard before adding a fourth.
- **Test your changes.** Run `npm test` before submitting a PR.

## Development setup

```bash
git clone https://github.com/RobySMiller/lazarus.git
cd lazarus
npm install
npm run build
npm test
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add tests if applicable
4. Run `npm run typecheck && npm run build && npm test`
5. Open a PR with a clear description of what and why

## What we're looking for

- Bug fixes
- Documentation improvements
- Test coverage
- Performance improvements
- Provider-specific deployment examples (Fly.io, Render, etc.)

## What we're NOT looking for (yet)

- Multi-standby / leader election
- State replication / sync
- Heavy new dependencies
- UI / dashboard features

## Code style

- TypeScript, strict mode
- ES modules (`import`/`export`, not `require`)
- Keep functions small and focused
- Use `logger` for all output (no raw `console.log` in library code)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
