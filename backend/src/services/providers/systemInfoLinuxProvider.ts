import { readFileSync } from "fs";
import { ExecTools } from "../../helpers/ExecTools";
import {
  DiskInfo,
  LogFileInfo,
  OsRelease,
  SystemInfoDetail,
  SystemInfoProvider,
  TimeshiftInfo,
} from "../systemInfoProvider";

/** Gather system info on Linux via standard CLI tools. */
export class SystemInfoLinuxProvider implements SystemInfoProvider {
  async isAvailable(): Promise<boolean> {
    return process.platform === "linux";
  }

  async getSystemInfo(): Promise<SystemInfoDetail> {
    return {
      os: await this.getOsRelease(),
      hostname: await this.getHostname(),
      kernel: await execStr("uname -r"),
      uptime: await execStr("uptime -p"),
      disks: await this.getDiskInfo(),
      logs: await this.getLogSizes(),
      timeshift: (await this.getTimeshiftInfo()) ?? undefined,
    };
  }

  private async getHostname(): Promise<string> {
    // 1. Read /etc/hostname directly (most reliable, no dependency on PATH)
    try {
      return readFileSync("/etc/hostname", "utf8").trim();
    } catch {
      // file doesn't exist or can't be read
    }
    // 2. Fallback to hostnamectl --static (systemd)
    const { stdout } = await ExecTools.safeExec("hostnamectl --static");
    if (stdout.trim()) return stdout.trim();
    // 3. Last resort: hostname command
    return execStr("hostname");
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
    const { stdout } = await ExecTools.safeExec(
      "df -BG --local -x tmpfs -x devtmpfs -x overlay -x efivarfs -x squashfs",
    );
    const disks: DiskInfo[] = [];
    const lines = stdout.trim().split("\n").slice(1);
    const skipPrefixes = ["/boot", "/efi", "/var", "/tmp", "/snap", "/private", "/System"];
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const mountPoint = parts[5];
        if (skipPrefixes.some((prefix) => mountPoint === prefix || mountPoint.startsWith(prefix + "/"))) continue;
        const total = parseInt(parts[1], 10);
        const used = parseInt(parts[2], 10);
        const available = parseInt(parts[3], 10);
        const pct = parseInt(parts[4].replace("%", ""), 10);
        disks.push({
          device: parts[0],
          mountPoint,
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

  private async getTimeshiftInfo(): Promise<TimeshiftInfo | null> {
    // Check if timeshift is installed
    const { stdout: whichOut } = await ExecTools.safeExec("which timeshift");
    if (!whichOut.trim()) return null;

    // Check sudo access
    const hasSudoResult = await ExecTools.safeExecWithCode("sudo -n true");
    if (hasSudoResult.exitCode !== 0) return null;

    // Read config
    let config: Record<string, string> = {};
    try {
      const raw = readFileSync("/etc/timeshift/timeshift.json", "utf8");
      config = JSON.parse(raw) as Record<string, string>;
    } catch {
      return null;
    }

    // Parse output of `sudo timeshift --list`
    const { stdout } = await ExecTools.safeExec("sudo timeshift --list");
    const lines = stdout.split("\n");

    // Use /^\s*\w+\s*:/ pattern to find "Key : Value" lines (not "Mounted")
    const findField = (name: string): string | null => {
      for (const line of lines) {
        if (new RegExp(`^\\s*${name}\\s*:`, "i").test(line)) {
          return line.split(":")[1].trim();
        }
      }
      return null;
    };

    const device = findField("Device") ?? "";
    const mode = (findField("Mode") ?? "RSYNC") as "RSYNC" | "BTRFS";

    // Parse free space: "3 snapshots, 2.8 TB free"
    const freeMatch = stdout.match(/(\d+(?:\.\d+)?)\s+(TB|GB|MB)\s+free/);
    const freeSpace = freeMatch ? this.parseSize(parseFloat(freeMatch[1]), freeMatch[2]) : 0;

    // Parse snapshots
    const snapshotMatch = stdout.match(/(\d+)\s+snapshots?/);
    const snapshots = snapshotMatch ? parseInt(snapshotMatch[1], 10) : 0;

    // Parse last snapshot name
    const lastSnapshot = this.parseLastSnapshot(lines);

    // Get total disk size from the backup device via df
    const totalSpace = await this.getDiskTotalSpace(device);

    // Parse schedules from config
    const schedules: string[] = [];
    if (config["schedule_weekly"] === "true") schedules.push("weekly");
    if (config["schedule_daily"] === "true") schedules.push("daily");
    if (config["schedule_monthly"] === "true") schedules.push("monthly");
    if (config["schedule_hourly"] === "true") schedules.push("hourly");
    if (config["schedule_boot"] === "true") schedules.push("boot");

    return { mode, device, snapshots, lastSnapshot, totalSpace, freeSpace, schedules };
  }

  private async getDiskTotalSpace(device: string): Promise<number> {
    if (!device) return 0;
    // blockdev works on unmounted devices (df does not)
    const { stdout } = await ExecTools.safeExec(`sudo blockdev --getsize64 "${device}" 2>/dev/null`);
    const bytes = parseInt(stdout.trim(), 10);
    return isNaN(bytes) ? 0 : bytes;
  }

  private parseSize(value: number, unit: string): number {
    switch (unit) {
      case "TB":
        return value * 1024 * 1024 * 1024 * 1024;
      case "GB":
        return value * 1024 * 1024 * 1024;
      case "MB":
        return value * 1024 * 1024;
      default:
        return value * 1024;
    }
  }

  private parseLastSnapshot(lines: string[]): string {
    const snapshotLines = lines.filter((line) => /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(line));
    if (snapshotLines.length === 0) return "";
    const last = snapshotLines[snapshotLines.length - 1].trim();
    const dateMatch = last.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    // Convert "2026-08-09_12-00-02" → "2026-08-09T12:00:02" (ISO for Angular date pipe)
    return dateMatch ? `${dateMatch[1]}T${dateMatch[2]}:${dateMatch[3]}:${dateMatch[4]}` : "";
  }
}

async function execStr(cmd: string): Promise<string> {
  const { stdout } = await ExecTools.safeExec(cmd);
  return stdout.trim();
}
