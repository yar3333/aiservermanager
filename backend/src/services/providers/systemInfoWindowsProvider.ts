import { ExecTools } from "../../helpers/ExecTools";
import { DiskInfo, LogFileInfo, OsRelease, SystemInfoDetail, SystemInfoProvider } from "../systemInfoProvider";

/** Gather system info on Windows via PowerShell (CIM). */
export class SystemInfoWindowsProvider implements SystemInfoProvider {
  async isAvailable(): Promise<boolean> {
    return process.platform === "win32";
  }

  async getSystemInfo(): Promise<SystemInfoDetail> {
    const [osWithBoot, hostname] = await Promise.all([this.getCimOsInfo(), execStr("hostname")]);
    const uptime = this.formatUptime(osWithBoot.bootTicks);

    return {
      os: osWithBoot.os,
      hostname,
      kernel: osWithBoot.os.version, // reuse version field for build number
      uptime,
      disks: await this.getDiskInfo(),
      logs: await this.getLogSizes(),
    };
  }

  /** Single CIM call → OS fields + LastBootUpTime epoch for uptime. */
  private async getCimOsInfo(): Promise<{ os: OsRelease; bootTicks: number }> {
    const { stdout } = await ExecTools.safeExec(
      "$os = Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{ Caption=$os.Caption; Version=$os.Version; BuildNumber=$os.BuildNumber; BootTicks=[long](Get-Date).Subtract($os.LastBootUpTime).TotalSeconds } | ConvertTo-Json",
    );
    try {
      const parsed = JSON.parse(stdout);
      return {
        os: {
          name: parsed.Caption ?? "Windows",
          version: parsed.Version ?? "",
          id: parsed.BuildNumber ?? "unknown",
        },
        bootTicks: typeof parsed.BootTicks === "number" ? parsed.BootTicks : 0,
      };
    } catch {
      return { os: { name: "Windows", version: "", id: "unknown" }, bootTicks: 0 };
    }
  }

  private formatUptime(totalSeconds: number): string {
    if (totalSeconds <= 0) return "unknown";
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    const time = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return days > 0 ? `${days} days, ${time}` : time;
  }

  private async getDiskInfo(): Promise<DiskInfo[]> {
    const { stdout } = await ExecTools.safeExec(
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json",
    );
    const disks: DiskInfo[] = [];
    try {
      const parsed = JSON.parse(stdout);
      // Single disk → object, not array; normalize
      const entries: any[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const d of entries) {
        const total = parseFloat(d.Size) || 0;
        const free = parseFloat(d.FreeSpace) || 0;
        const used = total - free;
        disks.push({
          device: d.DeviceID ?? "",
          mountPoint: d.DeviceID ?? "",
          total,
          used,
          available: free,
          usePercent: total > 0 ? Math.round((used / total) * 100) : 0,
        });
      }
    } catch {
      // fallback: empty
    }
    return disks;
  }

  private async getLogSizes(): Promise<LogFileInfo[]> {
    // Windows event log equivalent: check sizes of common log locations
    const paths = [
      "C:\\Windows\\System32\\winevt\\Logs\\System.evtx",
      "C:\\Windows\\System32\\winevt\\Logs\\Application.evtx",
    ];
    const results: LogFileInfo[] = [];
    for (const p of paths) {
      try {
        const { stdout } = await ExecTools.safeExec(
          `powershell -Command "(Get-Item '${p.replace(/\\/g, "\\")}' -ErrorAction SilentlyContinue).Length"`,
        );
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
