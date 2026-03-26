export interface HeartbeatPayload {
  timestamp: number;
  hostname: string;
  pid: number;
}

export interface HeartbeatStatus {
  status: 'ok';
  primaryAlive: boolean;
  lastHeartbeat: number | null;
  uptime: number;
  role: 'standby';
}
