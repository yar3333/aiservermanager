import "reflect-metadata";
import * as fs from "fs";
import { SysfsRenderIndexResolver } from "../sysfsRenderIndexResolver";
import * as execModule from "../../../helpers/ExecTools";
import { GpuInfo } from "../../../models/GpuInfo";

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
}));
jest.mock("../../../helpers/ExecTools");

const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

/** Real server output (2026-09-25) — ASPEED BMC card0 already filtered by the shell. */
const sysfsOutput = [
  "card1 0000:c3:00.0",
  "card2 0000:c6:00.0",
  "card3 0000:83:00.0",
  "card4 0000:86:00.0",
].join("\n");

function makeGpu(pciBusId: string, name = "AMD Radeon RX 7900 XTX"): GpuInfo {
  return { index: 0, vendor: "AMD", brand: "RADEON", name, gpuIndex: 0, vramTotal: 24, pciBusId };
}

describe("SysfsRenderIndexResolver", () => {
  let resolver: SysfsRenderIndexResolver;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    setPlatform("linux");
    resolver = new SysfsRenderIndexResolver();
  });

  afterEach(() => {
    setPlatform("linux");
  });

  describe("isAvailable", () => {
    it("returns true on linux when /sys/class/drm exists", async () => {
      expect(await resolver.isAvailable()).toBe(true);
    });

    it("returns false on linux without /sys/class/drm", async () => {
      mockExistsSync.mockReturnValue(false);
      expect(await resolver.isAvailable()).toBe(false);
    });

    it("returns false on non-linux", async () => {
      setPlatform("win32");
      expect(await resolver.isAvailable()).toBe(false);
      expect(mockExistsSync).not.toHaveBeenCalled();
    });
  });

  describe("resolve", () => {
    it("assigns indices by card order — the user's 4x 7900 XTX case", async () => {
      // Detector (rocm-smi) reports GPUs in BDF order — not HIP order
      const gpus = [makeGpu("83:00.0"), makeGpu("86:00.0"), makeGpu("C3:00.0"), makeGpu("C6:00.0")];

      mockSafeExec.mockResolvedValue({ stdout: sysfsOutput, stderr: "" });
      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(4);
      expect(gpus.find((g) => g.pciBusId === "C3:00.0")?.gpuIndex).toBe(0); // card1 → HIP 0
      expect(gpus.find((g) => g.pciBusId === "C6:00.0")?.gpuIndex).toBe(1); // card2 → HIP 1
      expect(gpus.find((g) => g.pciBusId === "83:00.0")?.gpuIndex).toBe(2); // card3 → HIP 2
      expect(gpus.find((g) => g.pciBusId === "86:00.0")?.gpuIndex).toBe(3); // card4 → HIP 3
    });

    it("skips render cards that are not in the detected list", async () => {
      const gpus = [makeGpu("C3:00.0"), makeGpu("83:00.0")];
      const output = sysfsOutput + "\ncard5 0000:ff:00.0"; // undetected iGPU

      mockSafeExec.mockResolvedValue({ stdout: output, stderr: "" });
      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(2);
      expect(gpus[0].gpuIndex).toBe(0);
      expect(gpus[1].gpuIndex).toBe(1);
    });

    it("sorts cards numerically, not lexicographically", async () => {
      const output = ["card10 0000:0a:00.0", "card1 0000:0b:00.0", "card2 0000:0c:00.0"].join("\n");
      const gpus = [makeGpu("0A:00.0"), makeGpu("0B:00.0"), makeGpu("0C:00.0")];

      mockSafeExec.mockResolvedValue({ stdout: output, stderr: "" });
      await resolver.resolve(gpus);

      expect(gpus.find((g) => g.pciBusId === "0B:00.0")?.gpuIndex).toBe(0); // card1
      expect(gpus.find((g) => g.pciBusId === "0C:00.0")?.gpuIndex).toBe(1); // card2
      expect(gpus.find((g) => g.pciBusId === "0A:00.0")?.gpuIndex).toBe(2); // card10
    });

    it("matches pciBusId case-insensitively without domain prefix", async () => {
      const gpus = [makeGpu("c3:00.0")]; // lowercase, no "0000:" domain

      mockSafeExec.mockResolvedValue({ stdout: "card1 0000:C3:00.0", stderr: "" });
      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(1);
      expect(gpus[0].gpuIndex).toBe(0);
    });

    it("returns 0 without touching GPUs on empty output", async () => {
      const gpus = [makeGpu("C3:00.0")];

      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "no such file" });
      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(0);
      expect(gpus[0].gpuIndex).toBe(0);
    });

    it("returns 0 for an empty GPU list without running the command", async () => {
      expect(await resolver.resolve([])).toBe(0);
      expect(mockSafeExec).not.toHaveBeenCalled();
    });

    it("skips malformed lines", async () => {
      const gpus = [makeGpu("C3:00.0")];
      const output = ["garbage", "cardX 0000:c3:00.0", "card1", "card1 0000:c3:00.0"].join("\n");

      mockSafeExec.mockResolvedValue({ stdout: output, stderr: "" });
      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(1);
      expect(gpus[0].gpuIndex).toBe(0);
    });
  });
});
