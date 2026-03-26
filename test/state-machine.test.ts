import { describe, it, expect, vi } from 'vitest';
import { FailoverStateMachine, type StateMachineConfig } from '../src/state-machine.js';

function createSM(
  overrides: Partial<StateMachineConfig> = {},
  clock?: () => number,
) {
  const onFailover = vi.fn();
  const onYield = vi.fn();
  const config: StateMachineConfig = {
    timeoutMs: 30_000,
    failoverThreshold: 3,
    recoveryThreshold: 3,
    ...overrides,
  };
  const sm = new FailoverStateMachine(config, onFailover, onYield, clock);
  return { sm, onFailover, onYield };
}

describe('FailoverStateMachine', () => {
  // ── Bug 1: Fresh start, no primary ──────────────────────────

  it('starts in UNKNOWN state', () => {
    const { sm } = createSM();
    expect(sm.state).toBe('UNKNOWN');
  });

  it('transitions UNKNOWN → FAILED when no heartbeat arrives within timeout', () => {
    let now = 0;
    const { sm, onFailover } = createSM({ timeoutMs: 100 }, () => now);

    // Before timeout: still UNKNOWN
    now = 50;
    sm.check();
    expect(sm.state).toBe('UNKNOWN');
    expect(onFailover).not.toHaveBeenCalled();

    // After timeout: FAILED
    now = 100;
    sm.check();
    expect(sm.state).toBe('FAILED');
    expect(onFailover).toHaveBeenCalledTimes(1);
  });

  it('transitions UNKNOWN → HEALTHY when heartbeat arrives', () => {
    let now = 0;
    const { sm, onFailover } = createSM({ timeoutMs: 100 }, () => now);

    now = 50;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('HEALTHY');
    expect(onFailover).not.toHaveBeenCalled();
  });

  // ── Normal failover ─────────────────────────────────────────

  it('HEALTHY → SUSPECT → FAILED after failoverThreshold misses', () => {
    let now = 0;
    const { sm, onFailover } = createSM(
      { timeoutMs: 50, failoverThreshold: 3 },
      () => now,
    );

    // Get to HEALTHY
    now = 10;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('HEALTHY');

    // Heartbeat stops, timeout expires
    now = 100;
    sm.check(); // miss 1 → SUSPECT
    expect(sm.state).toBe('SUSPECT');

    now = 110;
    sm.check(); // miss 2 → still SUSPECT
    expect(sm.state).toBe('SUSPECT');
    expect(onFailover).not.toHaveBeenCalled();

    now = 120;
    sm.check(); // miss 3 → FAILED
    expect(sm.state).toBe('FAILED');
    expect(onFailover).toHaveBeenCalledTimes(1);
  });

  // ── Primary returns ─────────────────────────────────────────

  it('FAILED → RECOVERING → HEALTHY after recoveryThreshold heartbeats', () => {
    let now = 0;
    const { sm, onYield } = createSM(
      { timeoutMs: 50, failoverThreshold: 1, recoveryThreshold: 3 },
      () => now,
    );

    // Get to FAILED
    now = 10;
    sm.heartbeat();
    sm.check();
    now = 100;
    sm.check(); // → FAILED
    expect(sm.state).toBe('FAILED');

    // Heartbeats resume
    now = 110;
    sm.heartbeat();
    sm.check(); // alive 1 → RECOVERING
    expect(sm.state).toBe('RECOVERING');
    expect(onYield).not.toHaveBeenCalled();

    now = 120;
    sm.heartbeat();
    sm.check(); // alive 2
    expect(sm.state).toBe('RECOVERING');

    now = 130;
    sm.heartbeat();
    sm.check(); // alive 3 → HEALTHY, fire onYield
    expect(sm.state).toBe('HEALTHY');
    expect(onYield).toHaveBeenCalledTimes(1);
  });

  // ── Flapping / WiFi drops ───────────────────────────────────

  it('SUSPECT resets to HEALTHY on heartbeat (no thrashing)', () => {
    let now = 0;
    const { sm, onFailover } = createSM(
      { timeoutMs: 50, failoverThreshold: 3 },
      () => now,
    );

    // Get to HEALTHY
    now = 10;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('HEALTHY');

    // Miss one check → SUSPECT
    now = 100;
    sm.check();
    expect(sm.state).toBe('SUSPECT');

    // Heartbeat arrives → back to HEALTHY, counter reset
    now = 105;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('HEALTHY');
    expect(onFailover).not.toHaveBeenCalled();
  });

  it('RECOVERING falls back to FAILED on missed heartbeat', () => {
    let now = 0;
    const { sm, onYield } = createSM(
      { timeoutMs: 50, failoverThreshold: 1, recoveryThreshold: 3 },
      () => now,
    );

    // Get to FAILED
    now = 10;
    sm.heartbeat();
    sm.check();
    now = 100;
    sm.check();
    expect(sm.state).toBe('FAILED');

    // Start recovering
    now = 110;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('RECOVERING');

    // Miss a heartbeat during recovery
    now = 200;
    sm.check();
    expect(sm.state).toBe('FAILED');
    expect(onYield).not.toHaveBeenCalled();
  });

  // ── Edge cases ──────────────────────────────────────────────

  it('recoveryThreshold=1 goes directly FAILED → HEALTHY', () => {
    let now = 0;
    const { sm, onYield } = createSM(
      { timeoutMs: 50, failoverThreshold: 1, recoveryThreshold: 1 },
      () => now,
    );

    // Get to FAILED
    now = 10;
    sm.heartbeat();
    sm.check();
    now = 100;
    sm.check();
    expect(sm.state).toBe('FAILED');

    // Single heartbeat → straight to HEALTHY
    now = 110;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('HEALTHY');
    expect(onYield).toHaveBeenCalledTimes(1);
  });

  it('does not fire onFailover twice in FAILED state', () => {
    let now = 0;
    const { sm, onFailover } = createSM(
      { timeoutMs: 50, failoverThreshold: 1 },
      () => now,
    );

    // Get to FAILED
    now = 10;
    sm.heartbeat();
    sm.check();
    now = 100;
    sm.check();
    expect(onFailover).toHaveBeenCalledTimes(1);

    // Keep checking — no additional calls
    now = 200;
    sm.check();
    now = 300;
    sm.check();
    expect(onFailover).toHaveBeenCalledTimes(1);
  });

  it('does not fire onYield when still in RECOVERING', () => {
    let now = 0;
    const { sm, onYield } = createSM(
      { timeoutMs: 50, failoverThreshold: 1, recoveryThreshold: 5 },
      () => now,
    );

    // Get to FAILED
    now = 10;
    sm.heartbeat();
    sm.check();
    now = 100;
    sm.check();

    // Partially recover (2 of 5 needed)
    now = 110;
    sm.heartbeat();
    sm.check();
    now = 120;
    sm.heartbeat();
    sm.check();
    expect(sm.state).toBe('RECOVERING');
    expect(onYield).not.toHaveBeenCalled();
  });

  it('tracks lastHeartbeat timestamp', () => {
    let now = 0;
    const { sm } = createSM({}, () => now);

    expect(sm.lastHeartbeat).toBe(0);

    now = 12345;
    sm.heartbeat();
    expect(sm.lastHeartbeat).toBe(12345);
  });
});
