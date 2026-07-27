import os from "os";

export interface SystemInfo {
  cpuUsage: number; // percentage 0-100
  memoryTotal: number; // bytes
  memoryUsed: number; // bytes
  memoryPercent: number; // percentage 0-100
}

/** One-time snapshot of CPU idle/total for delta calculation. */
interface CpuSnapshot {
  idle: number;
  total: number;
}

export class SystemService {
  private snapshot: CpuSnapshot | null = null;

  private readCpuTimes(): CpuSnapshot {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
      for (const _key in cpu.times) {
        const val = cpu.times[_key as keyof typeof cpu.times];
        total += val;
      }
      idle += cpu.times.idle;
    }
    return { idle, total };
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const now = this.readCpuTimes();

    let cpuUsage = 0;
    if (this.snapshot) {
      const idleDelta = now.idle - this.snapshot.idle;
      const totalDelta = now.total - this.snapshot.total;
      cpuUsage = totalDelta > 0 ? ((1 - idleDelta / totalDelta) * 100) : 0;
    }

    this.snapshot = now;

    const memoryTotal = os.totalmem();
    const memoryUsed = memoryTotal - os.freemem();

    return {
      cpuUsage: Math.round(cpuUsage * 10) / 10,
      memoryTotal,
      memoryUsed,
      memoryPercent: Math.round((memoryUsed / memoryTotal) * 1000) / 10,
    };
  }
}
