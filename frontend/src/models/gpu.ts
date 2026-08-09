/** Static GPU information — loaded once on init. */
export interface Gpu {
  index: number;
  vendor: string;
  brand: string;
  name: string;
  engineCudaName: string;
  engineRocmName: string;
  engineVulkanName: string;
  vramTotal: number;
  pciBusId: string;
}

/** Dynamic GPU metrics — polled from backend. */
export interface GpuUsage {
  key: string;
  usage: number;
  temperature: number;
  vramUsed: number;
}

/** Full GPU display record = static info merged with latest usage. */
export type GpuWithUsage = Gpu & GpuUsage;

/** Unified poll response: GPU usage + system info in one request. */
export interface GpuStatusResponse {
  gpus: GpuUsage[];
  system: SystemInfo;
}

export interface SystemInfo {
  cpuUsage: number;
  memoryTotal: number;
  memoryUsed: number;
  memoryPercent: number;
}

/* ------------------------------------------------------------------ */
/*  System info dialog                                                 */
/* ------------------------------------------------------------------ */

export interface OsRelease {
  name: string;
  version: string;
  id: string;
}

export interface DiskInfo {
  device: string;
  mountPoint: string;
  total: number;
  used: number;
  available: number;
  usePercent: number;
}

export interface LogFileInfo {
  path: string;
  size: number;
  exists: boolean;
}

export interface SystemInfoDetail {
  os: OsRelease;
  hostname: string;
  kernel: string;
  uptime: string;
  disks: DiskInfo[];
  logs: LogFileInfo[];
}
