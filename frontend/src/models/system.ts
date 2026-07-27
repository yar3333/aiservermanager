/** System resource metrics — polled from backend. */
export interface SystemInfo {
  cpuUsage: number; // percentage 0-100
  memoryTotal: number; // bytes
  memoryUsed: number; // bytes
  memoryPercent: number; // percentage 0-100
}
