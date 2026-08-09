import { ExecTools } from "../../helpers/ExecTools";
import { DiskInfo, LogFileInfo, OsRelease, SystemInfoDetail, SystemInfoProvider } from "../systemInfoProvider";

/** Gather system info on Linux via standard CLI tools. */
export class SystemInfoLinuxProvider implements SystemInfoProvider {
  async isAvailable(): Promise<boolean> {
    return process.platform === "linux";
  }

  async getSystemInfo(): Promise<SystemInfoDetail> {
    return {
      os: await this.getOsRelease(),
      hostname: await execStr("hostname"),
      kernel: await execStr("uname -r"),
      uptime: await execStr("uptime -p"),
      disks: await this.getDiskInfo(),
      logs: await this.getLogSizes(),
    };
  }

  private async getOsRelease(): Promise<OsRelease> {
    const { stdout } = await ExecTools.safeExec("cat /etc/os-release");
    const parse = (line: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const m of line.matchAll(
        /^(PRETTY_NAME|NAME|VERSION|ID)=\"([^\"]*)\"|^(PRETTY_NAME|NAME|VERSION|ID)=(\S+)/gm,
      )) {
        const key = (m[1] ?? m[3]).toUpperCase();
        const value = m[2] ?? m[4];
        out[key] = value;
      }
      return out;
    };
    const r = parse(stdout);
    return {
      name: r.PRETTY_NAME ?? r.NAME ?? "Unknown",
      version: r.VERSION ?? "",
      id: r.ID ?? "unknown",
    };
  }

  private async getDiskInfo(): Promise<DiskInfo[]> {
    const { stdout } = await ExecTools.safeExec("df -BG --local -x tmpfs -x devtmpfs -x overlay");
    const disks: DiskInfo[] = [];
    const lines = stdout.trim().split("\n").slice(1);
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const total = parseInt(parts[1], 10);
        const used = parseInt(parts[2], 10);
        const available = parseInt(parts[3], 10);
        const pct = parseInt(parts[4].replace("%", ""), 10);
        disks.push({
          device: parts[0],
          mountPoint: parts[5],
          total: isNaN(total) ? 0 : total * 1024 * 1024 * 1024,
          used: isNaN(used) ? 0 : used * 1024 * 1024 * 1024,
          available: isNaN(available) ? 0 : available * 1024 * 1024 * 1024,
          usePercent: isNaN(pct) ? 0 : pct,
        });
      }
    }
    return disks;
  }

  private async getLogSizes(): Promise<LogFileInfo[]> {
    const paths = ["/var/log/kern.log", "/var/log/syslog"];
    const results: LogFileInfo[] = [];
    for (const p of paths) {
      try {
        const { stdout } = await ExecTools.safeExec(`stat --format="%s" "${p}" 2>/dev/null`);
        const size = parseInt(stdout.trim(), 10);
        results.push({ path: p, size: isNaN(size) ? 0 : size, exists: true });
      } catch {
        results.push({ path: p, size: 0, exists: false });
      }
    }
    return results;
  }
}

async function execStr(cmd: string): Promise<string> {
  const { stdout } = await ExecTools.safeExec(cmd);
  return stdout.trim();
}
