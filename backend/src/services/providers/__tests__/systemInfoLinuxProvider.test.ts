import { SystemInfoLinuxProvider } from "../systemInfoLinuxProvider";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("../../../helpers/ExecTools");
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

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
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd === "cat /etc/os-release") return { stdout: osReleaseStdout, stderr: "" };
        if (cmd === "hostname") return { stdout: "myserver\n", stderr: "" };
        if (cmd === "uname -r") return { stdout: "6.8.0-51-generic\n", stderr: "" };
        if (cmd === "uptime -p") return { stdout: "up 42 days, 3 hours\n", stderr: "" };
        if (cmd.startsWith("df ")) return { stdout: dfStdout, stderr: "" };
        if (cmd.includes("stat")) return { stdout: "1048576\n", stderr: "" };
        return { stdout: "", stderr: "" };
      });
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
  });

  describe("getDiskInfo", () => {
    it("returns empty array when df output is empty", async () => {
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
  });
});
