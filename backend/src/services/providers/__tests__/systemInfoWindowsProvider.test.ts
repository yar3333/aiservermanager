import { SystemInfoWindowsProvider } from "../systemInfoWindowsProvider";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("../../../helpers/ExecTools");
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

function createProvider(platform: NodeJS.Platform = "win32"): SystemInfoWindowsProvider {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  const p = new SystemInfoWindowsProvider();
  Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  return p;
}

const diskJson = JSON.stringify([
  { DeviceID: "C:", VolumeName: "OS", Size: "536870912000", FreeSpace: "214748364800" },
  { DeviceID: "D:", VolumeName: "DATA", Size: "2199023255552", FreeSpace: "1099511627776" },
]);

/** Build a combined CIM JSON response for the single PowerShell call. */
function cimJson(opts: { caption?: string; version?: string; build?: string; bootTicks: number }): string {
  return JSON.stringify({
    Caption: opts.caption ?? "Microsoft Windows 11 Pro",
    Version: opts.version ?? "10.0.26100",
    BuildNumber: opts.build ?? "26100",
    BootTicks: opts.bootTicks,
  });
}

describe("SystemInfoWindowsProvider", () => {
  let provider: SystemInfoWindowsProvider;

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

    it("returns true on win32", async () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const p = new SystemInfoWindowsProvider();
      expect(await p.isAvailable()).toBe(true);
    });

    it("returns false on linux", async () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      const p = new SystemInfoWindowsProvider();
      expect(await p.isAvailable()).toBe(false);
    });

    it("returns false on darwin", async () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      const p = new SystemInfoWindowsProvider();
      expect(await p.isAvailable()).toBe(false);
    });
  });

  describe("getSystemInfo", () => {
    /** 5 days, 12:30:45 = 477045 seconds */
    function mockAllResponses(): void {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) {
          return { stdout: cimJson({ bootTicks: 477045 }) + "\n", stderr: "" };
        }
        if (cmd === "hostname") return { stdout: "DESKTOP-ABC123\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) {
          return { stdout: diskJson + "\n", stderr: "" };
        }
        if (cmd.includes("Get-Item")) {
          return { stdout: "2097152\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });
    }

    it("returns full system info", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Microsoft Windows 11 Pro");
      expect(info.os.version).toBe("10.0.26100");
      expect(info.os.id).toBe("26100");
      expect(info.hostname).toBe("DESKTOP-ABC123");
    });

    it("formats uptime from BootTicks", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.uptime).toBe("5 days, 12:30:45");
    });

    it("parses multiple disks", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.disks).toHaveLength(2);
      expect(info.disks[0].device).toBe("C:");
      expect(info.disks[0].total).toBe(536870912000);
      expect(info.disks[0].available).toBe(214748364800);
      expect(info.disks[0].used).toBe(322122547200);
      expect(info.disks[1].device).toBe("D:");
    });

    it("computes usePercent correctly", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      // C: used = 60%, D: used = 50%
      expect(info.disks[0].usePercent).toBe(60);
      expect(info.disks[1].usePercent).toBe(50);
    });

    it("returns two log file entries", async () => {
      mockAllResponses();
      const info = await provider.getSystemInfo();

      expect(info.logs).toHaveLength(2);
      expect(info.logs[0].path).toBe("C:\\Windows\\System32\\winevt\\Logs\\System.evtx");
      expect(info.logs[0].exists).toBe(true);
      expect(info.logs[0].size).toBe(2097152);
      expect(info.logs[1].path).toBe("C:\\Windows\\System32\\winevt\\Logs\\Application.evtx");
    });
  });

  describe("getCimOsInfo", () => {
    it("handles malformed JSON gracefully", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: "not-json", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();

      expect(info.os.name).toBe("Windows");
      expect(info.os.version).toBe("");
      expect(info.os.id).toBe("unknown");
      expect(info.uptime).toBe("unknown");
    });

    it("handles empty stdout", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: "", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.os.name).toBe("Windows");
    });
  });

  describe("formatUptime", () => {
    it("formats less than 1 day", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 37230 }) + "\n", stderr: "" }; // 10:20:30
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.uptime).toBe("10:20:30");
    });

    it("handles zero bootTicks", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 0 }) + "\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.uptime).toBe("unknown");
    });

    it("formats 1 day correctly", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 90000 }) + "\n", stderr: "" }; // 1 day, 01:00:00
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.uptime).toBe("1 days, 01:00:00");
    });
  });

  describe("getDiskInfo", () => {
    it("returns empty array when JSON parse fails", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 0 }) + "\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "broken", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks).toEqual([]);
    });

    it("handles single disk", async () => {
      const singleDisk = JSON.stringify([
        { DeviceID: "C:", VolumeName: "OS", Size: "1000000000000", FreeSpace: "500000000000" },
      ]);

      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 97200 }) + "\n", stderr: "" }; // 1 day, 03:00:00
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: singleDisk + "\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks).toHaveLength(1);
      expect(info.disks[0].usePercent).toBe(50);
    });

    it("handles single disk returned as object (not array)", async () => {
      // PowerShell's ConvertTo-Json returns a single object { } for one item, not [ { } ]
      const singleObj = JSON.stringify({
        DeviceID: "C:",
        VolumeName: "OS",
        Size: "500000000000",
        FreeSpace: "250000000000",
      });

      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 0 }) + "\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: singleObj + "\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks).toHaveLength(1);
      expect(info.disks[0].device).toBe("C:");
      expect(info.disks[0].usePercent).toBe(50);
    });

    it("handles disk with zero size gracefully", async () => {
      const zeroDisk = JSON.stringify([{ DeviceID: "E:", VolumeName: "", Size: "0", FreeSpace: "0" }]);

      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 0 }) + "\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: zeroDisk + "\n", stderr: "" };
        if (cmd.includes("Get-Item")) return { stdout: "0\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();
      expect(info.disks).toHaveLength(1);
      expect(info.disks[0].usePercent).toBe(0);
    });
  });

  describe("getLogSizes", () => {
    it("handles missing log files", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 0 }) + "\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        // Both log file checks fail
        if (cmd.includes("Get-Item")) throw new Error("not found");
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();

      expect(info.logs[0].exists).toBe(false);
      expect(info.logs[0].size).toBe(0);
      expect(info.logs[1].exists).toBe(false);
      expect(info.logs[1].size).toBe(0);
    });

    it("handles one existing and one missing", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("Win32_OperatingSystem")) return { stdout: cimJson({ bootTicks: 0 }) + "\n", stderr: "" };
        if (cmd === "hostname") return { stdout: "x\n", stderr: "" };
        if (cmd.includes("Win32_LogicalDisk")) return { stdout: "[]\n", stderr: "" };
        if (cmd.includes("System.evtx")) return { stdout: "4194304\n", stderr: "" };
        if (cmd.includes("Application.evtx")) throw new Error("not found");
        return { stdout: "", stderr: "" };
      });

      const info = await provider.getSystemInfo();

      expect(info.logs[0].exists).toBe(true);
      expect(info.logs[0].size).toBe(4194304);
      expect(info.logs[1].exists).toBe(false);
    });
  });
});
