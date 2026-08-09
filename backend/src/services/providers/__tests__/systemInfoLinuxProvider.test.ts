import * as fs from "fs";
import { SystemInfoLinuxProvider } from "../systemInfoLinuxProvider";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("fs", () => ({
  readFileSync: jest.fn(),
}));
const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

jest.mock("../../../helpers/ExecTools");
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;
const mockSafeExecWithCode = execModule.ExecTools.safeExecWithCode as jest.MockedFunction<
  typeof execModule.ExecTools.safeExecWithCode
>;

function createProvider(platform: NodeJS.Platform = "linux"): SystemInfoLinuxProvider {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  const p = new SystemInfoLinuxProvider();
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  return p;
}

const osReleaseStdout = `PRETTY_NAME="Ubuntu 24.04.2 LTS"
NAME="Ubuntu"
VERSION="24.04.2 LTS (Noble Numbat)"
ID=ubuntu
ID_LIKE=debian
VERSION_ID="24.04"
`;

const dfStdout = `Filesystem     1G-blocks  Used Available Use% Mounted on
/dev/sda1             500   200       300  40% /
/dev/nvme0n1p1       1000   750       250  75% /home
`;

describe("SystemInfoLinuxProvider", () => {
  let provider: SystemInfoLinuxProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = createProvider();
  });

  describe("isAvailable", () => {
    let originalPlatform: NodeJS.Platform;

    beforeAll(() => {
      originalPlatform = process.platform;
    });

    afterAll(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    it("returns true on linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      const p = new SystemInfoLinuxProvider();
      expect(await p.isAvailable()).toBe(true);
    });

    it("returns false on win32", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const p = new SystemInfoLinuxProvider();
      expect(await p.isAvailable()).toBe(false);
    });

    it("returns false on darwin", async () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      const p = new SystemInfoLinuxProvider();
      expect(await p.isAvailable()).toBe(false);
    });
  });

  describe("getSystemInfo", () => {
    function mockAllResponses(): void {
      mockReadFileSync.mockReturnValue("myserver\n");
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "myserver\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0-51-generic\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up 42 days, 3 hours\n", stderr: "" };
        if (cmd === "which timeshift") return { stdout: "", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "1048576\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });
      mockSafeExecWithCode.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    }

    it("returns full system info", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Ubuntu 24.04.2 LTS");
      expect(info.os.version).toBe("24.04.2 LTS (Noble Numbat)");
      expect(info.os.id).toBe("ubuntu");
      expect(info.hostname).toBe("myserver");
      expect(info.kernel).toBe("6.8.0-51-generic");
      expect(info.uptime).toBe("up 42 days, 3 hours");
    });

    it("parses multiple disks from df output", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.disks).toHaveLength(2);
      expect(info.disks[0].device).toBe("/dev/sda1");
      expect(info.disks[0].mountPoint).toBe("/");
      expect(info.disks[0].usePercent).toBe(40);
      expect(info.disks[1].device).toBe("/dev/nvme0n1p1");
      expect(info.disks[1].mountPoint).toBe("/home");
      expect(info.disks[1].usePercent).toBe(75);
    });

    it("converts disk sizes from GB to bytes", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      // 500 GB = 500 * 1024^3
      expect(info.disks[0].total).toBe(500 * 1024 * 1024 * 1024);
      expect(info.disks[0].available).toBe(300 * 1024 * 1024 * 1024);
      expect(info.disks[0].used).toBe(200 * 1024 * 1024 * 1024);
    });

    it("returns two log file entries", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.logs).toHaveLength(2);
      expect(info.logs[0].path).toBe("/var/log/kern.log");
      expect(info.logs[0].exists).toBe(true);
      expect(info.logs[0].size).toBe(1048576);
      expect(info.logs[1].path).toBe("/var/log/syslog");
      expect(info.logs[1].exists).toBe(true);
    });

    it("handles missing log file", async () => {
      mockReadFileSync.mockReturnValue("srv\n");
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "srv\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up 1 day\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("kern.log")) return { stdout: "500000\n", stderr: "" };
        // syslog stat fails
        if (cmd.includes("syslog")) throw new Error("ENOENT");
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();

      expect(info.logs[0].exists).toBe(true);
      expect(info.logs[0].size).toBe(500000);
      expect(info.logs[1].exists).toBe(false);
      expect(info.logs[1].size).toBe(0);
    });
  });

  describe("getOsRelease", () => {
    it("parses os-release with quoted values", async () => {
      mockSafeExec.mockResolvedValue({ stdout: osReleaseStdout, stderr: "" });
      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Ubuntu 24.04.2 LTS");
    });

    it("falls back to NAME when PRETTY_NAME is missing", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: 'NAME="Debian GNU/Linux"\nID=debian\n',
        stderr: "",
      });
      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Debian GNU/Linux");
      expect(info.os.version).toBe("");
    });

    it("falls back to 'Unknown' when both PRETTY_NAME and NAME are missing", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "ID=arch\n", stderr: "" });
      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Unknown");
      expect(info.os.id).toBe("arch");
    });

    it("handles empty os-release", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });
      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Unknown");
      expect(info.os.id).toBe("unknown");
    });

    it("falls back to hostnamectl when /etc/hostname is missing", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostnamectl --static") return { stdout: "fallback-host\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "should-not-reach\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up 1 day\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.hostname).toBe("fallback-host");
    });

    it("falls back to hostname command when both /etc/hostname and hostnamectl fail", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT");
      });
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostnamectl --static") return { stdout: "", stderr: "not available" };
        if (cmd === "hostname") return { stdout: "last-resort\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up 1 day\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.hostname).toBe("last-resort");
    });
  });

  describe("getDiskInfo", () => {
    it("returns empty array when df output is empty", async () => {
      mockReadFileSync.mockReturnValue("x\n");
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });

      // Need to mock all commands for getSystemInfo, but we only care about df
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "5.15\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: "", stderr: "" };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks).toEqual([]);
    });

    it("skips malformed df lines", async () => {
      mockReadFileSync.mockReturnValue("x\n");
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "5.15\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df "))
          return {
            stdout: "Filesystem 1G-blocks Used Available Use% Mounted on\nbad line here\n/dev/sda1 500 200 300 40% /\n",
            stderr: "",
          };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks).toHaveLength(1);
      expect(info.disks[0].device).toBe("/dev/sda1");
    });

    it("handles high usage disk (over 90%)", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "5.15\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df "))
          return {
            stdout: "Filesystem 1G-blocks Used Available Use% Mounted on\n/dev/sda1 100 95 5 95% /\n",
            stderr: "",
          };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks[0].usePercent).toBe(95);
    });

    it("filters out system mount points (/boot, /boot/efi, /snap, etc.)", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "5.15\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df "))
          return {
            stdout: `Filesystem 1G-blocks Used Available Use% Mounted on
/dev/sda1        500   200       300  40% /
/dev/nvme0n1p1   1000   750       250  75% /home
/dev/sda15         51    21        30  41% /boot/efi
/dev/sda14        512    12       500   2% /boot
/snap/core20      79     79         0 100% /snap/core20
/dev/sdb1        2000   800      1200  40% /data`,
            stderr: "",
          };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      const mountPoints = info.disks.map((d) => d.mountPoint);
      expect(mountPoints).toEqual(["/", "/home", "/data"]);
      expect(mountPoints).not.toContain("/boot");
      expect(mountPoints).not.toContain("/boot/efi");
      expect(mountPoints).not.toContain("/snap/core20");
    });
  });

  describe("getTimeshiftInfo", () => {
    it("returns null when timeshift is not installed", async () => {
      mockReadFileSync.mockReturnValue("x\n");
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "which timeshift") return { stdout: "", stderr: "" };
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostnamectl --static") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.timeshift).toBeUndefined();
    });

    it("returns null when sudo is not available", async () => {
      mockReadFileSync.mockReturnValue("x\n");
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "which timeshift") return { stdout: "/usr/bin/timeshift\n", stderr: "" };
        if (cmd === "sudo -n true") return { stdout: "", stderr: "sudo: a password is required" };
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostnamectl --static") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });
      mockSafeExecWithCode.mockResolvedValue({ stdout: "", stderr: "password required", exitCode: 1 });

      const info = await provider.getSystemInfo();
      expect(info.timeshift).toBeUndefined();
    });

    it("parses timeshift output correctly", async () => {
      const timeshiftConfig = JSON.stringify({
        backup_device_uuid: "9d8a679c-fa4c-4ce5-8235-17a7feb5d961",
        btrfs_mode: "false",
        schedule_weekly: "true",
        schedule_daily: "false",
        schedule_monthly: "true",
        schedule_hourly: "false",
        schedule_boot: "false",
      });

      const timeshiftOutput = `Mounted '/dev/sdb1' at '/run/timeshift/94001/backup'
Device : /dev/sdb1
UUID   : 9d8a679c-fa4c-4ce5-8235-17a7feb5d961
Path   : /run/timeshift/94001/backup
Mode   : RSYNC
Status : OK
3 snapshots, 2.8 TB free

Num     Name                 Tags  Description  
------------------------------------------------------------------------------
0    >  2026-06-28_20-31-11  O                  
1    >  2026-07-30_21-00-03  W                  
2    >  2026-08-09_12-00-02  W`;

      // blockdev --getsize64 returns bytes
      const blockdevOutput = "4000785104896\n";

      mockReadFileSync.mockReturnValue(timeshiftConfig);
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "which timeshift") return { stdout: "/usr/bin/timeshift\n", stderr: "" };
        if (cmd === "sudo -n true") return { stdout: "", stderr: "" };
        if (cmd === "sudo timeshift --list") return { stdout: timeshiftOutput, stderr: "" };
        if (cmd.includes("blockdev")) return { stdout: blockdevOutput, stderr: "" };
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostnamectl --static") return { stdout: "x\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });
      mockSafeExecWithCode.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const info = await provider.getSystemInfo();
      expect(info.timeshift).not.toBeNull();
      expect(info.timeshift!.mode).toBe("RSYNC");
      expect(info.timeshift!.device).toBe("/dev/sdb1");
      expect(info.timeshift!.snapshots).toBe(3);
      // lastSnapshot should be ISO format for Angular date pipe
      expect(info.timeshift!.lastSnapshot).toBe("2026-08-09T12:00:02");
      expect(info.timeshift!.freeSpace).toBe(2.8 * 1024 * 1024 * 1024 * 1024);
      expect(info.timeshift!.totalSpace).toBe(4000785104896);
      expect(info.timeshift!.schedules).toEqual(["weekly", "monthly"]);
    });
  });
});
