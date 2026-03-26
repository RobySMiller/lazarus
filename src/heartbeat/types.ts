import type { State } from '../state-machine.js';

export interface HeartbeatPayload {
  timestamp: number;
  hostname: string;
  pid: number;
}

export interface HeartbeatStatus {
  status: 'ok';
  state: State;
  primaryAlive: boolean;
  lastHeartbeat: number | null;
  uptime: number;
  role: 'standby';
}
