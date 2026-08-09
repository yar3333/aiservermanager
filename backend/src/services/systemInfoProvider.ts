/** Operating system release info. */
export interface OsRelease {
  name: string;
  version: string;
  id: string;
}

/** Disk usage record. */
export interface DiskInfo {
  device: string;
  mountPoint: string;
  total: number;
  used: number;
  available: number;
  usePercent: number;
}

/** Log file size record. */
export interface LogFileInfo {
  path: string;
  size: number;
  exists: boolean;
}

/** Full system info returned to the client. */
export interface SystemInfoDetail {
  os: OsRelease;
  hostname: string;
  kernel: string;
  uptime: string;
  disks: DiskInfo[];
  logs: LogFileInfo[];
}

/**
 * Strategy interface for gathering system information.
 * Each platform-specific implementation collects OS, disk, and log data
 * using the tools available on that OS.
 */
export interface SystemInfoProvider {
  /** @returns true if this provider works on the current platform. */
  isAvailable(): Promise<boolean>;

  /** Gather system info (OS, disks, logs). */
  getSystemInfo(): Promise<SystemInfoDetail>;
}
