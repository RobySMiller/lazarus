/**
 * Explicit failover state machine.
 *
 * States:
 *   UNKNOWN    → initial, never heard from primary
 *   HEALTHY    → heartbeats arriving normally
 *   SUSPECT    → heartbeats missed, not yet failed over
 *   FAILED     → primary is dead, standby has taken over
 *   RECOVERING → heartbeats resumed, waiting for stability
 *
 * Pure logic — no I/O, no timers. Driven by external check() calls.
 */

export type State = 'UNKNOWN' | 'HEALTHY' | 'SUSPECT' | 'FAILED' | 'RECOVERING';

export interface StateMachineConfig {
  timeoutMs: number;           // ms without heartbeat before primary is "not alive"
  failoverThreshold: number;   // consecutive !alive checks before SUSPECT → FAILED
  recoveryThreshold: number;   // consecutive alive checks before RECOVERING → HEALTHY
}

export class FailoverStateMachine {
  private _state: State = 'UNKNOWN';
  private lastHeartbeatAt = 0;
  private consecutiveMisses = 0;
  private consecutiveAlive = 0;
  private readonly startedAt: number;

  constructor(
    private readonly config: StateMachineConfig,
    private readonly onFailover: () => void,
    private readonly onYield: () => void,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
  }

  /** Call when a heartbeat is received from the primary. */
  heartbeat(): void {
    this.lastHeartbeatAt = this.clock();
  }

  /**
   * Call on a regular interval (e.g. every 5s).
   * Evaluates whether the primary is alive and drives state transitions.
   */
  check(): void {
    const now = this.clock();
    const alive = this.lastHeartbeatAt > 0 &&
      (now - this.lastHeartbeatAt) < this.config.timeoutMs;

    if (alive) {
      this.consecutiveAlive++;
      this.consecutiveMisses = 0;
    } else {
      this.consecutiveMisses++;
      this.consecutiveAlive = 0;
    }

    switch (this._state) {
      case 'UNKNOWN':
        if (alive) {
          this._state = 'HEALTHY';
        } else if (now - this.startedAt >= this.config.timeoutMs) {
          this._state = 'FAILED';
          this.onFailover();
        }
        break;

      case 'HEALTHY':
        if (!alive) {
          if (this.consecutiveMisses >= this.config.failoverThreshold) {
            this._state = 'FAILED';
            this.onFailover();
          } else {
            this._state = 'SUSPECT';
          }
        }
        break;

      case 'SUSPECT':
        if (alive) {
          this._state = 'HEALTHY';
        } else if (this.consecutiveMisses >= this.config.failoverThreshold) {
          this._state = 'FAILED';
          this.onFailover();
        }
        break;

      case 'FAILED':
        if (alive) {
          this.consecutiveAlive = 1;
          if (this.config.recoveryThreshold <= 1) {
            this._state = 'HEALTHY';
            this.onYield();
          } else {
            this._state = 'RECOVERING';
          }
        }
        break;

      case 'RECOVERING':
        if (!alive) {
          this._state = 'FAILED';
          this.consecutiveAlive = 0;
        } else if (this.consecutiveAlive >= this.config.recoveryThreshold) {
          this._state = 'HEALTHY';
          this.onYield();
        }
        break;
    }
  }

  get state(): State {
    return this._state;
  }

  get lastHeartbeat(): number {
    return this.lastHeartbeatAt;
  }
}
