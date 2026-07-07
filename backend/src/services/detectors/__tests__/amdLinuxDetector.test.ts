import "reflect-metadata";
import { AmdLinuxDetector } from "../amdLinuxDetector";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("../../../helpers/ExecTools");
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

describe("AmdLinuxDetector", () => {
  let detector: AmdLinuxDetector;

  function createDetector(platform: NodeJS.Platform = "linux"): AmdLinuxDetector {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    const d = new AmdLinuxDetector();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    return d;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    detector = createDetector();
  });

  const productJson = JSON.stringify({
    card0: { "Card Series": "AMD Radeon RX 7900 XTX" },
    card1: { "Card Series": "AMD Radeon RX 7900 XTX" },
  });

  const tempJson = JSON.stringify({
    card0: { "Temperature (Sensor edge) (C)": "45.0" },
    card1: { "Temperature (Sensor edge) (C)": "48.0" },
  });

  const usageJson = JSON.stringify({
    card0: { "GPU use (%)": "20" },
    card1: { "GPU use (%)": "15" },
  });

  const memJson = JSON.stringify({
    card0: { "VRAM Total Memory (B)": "25753026560", "VRAM Total Used Memory (B)": "14252920832" },
    card1: { "VRAM Total Memory (B)": "25753026560", "VRAM Total Used Memory (B)": "8589934592" },
  });

  const busJson = JSON.stringify({
    card0: { "PCI Bus": "0000:05:00.0" },
    card1: { "PCI Bus": "0000:08:00.0" },
  });

  function mockAllResponses(): void {
    mockSafeExec.mockImplementation(async (cmd: string) => {
      if (cmd.includes("showproductname")) return { stdout: productJson, stderr: "" };
      if (cmd.includes("-t")) return { stdout: tempJson, stderr: "" };
      if (cmd.includes("-u")) return { stdout: usageJson, stderr: "" };
      if (cmd.includes("showmeminfo")) return { stdout: memJson, stderr: "" };
      if (cmd.includes("showbus")) return { stdout: busJson, stderr: "" };
      return { stdout: "", stderr: "" };
    });
  }

  describe("isAvailable", () => {
    it("returns true when rocm-smi returns output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: productJson, stderr: "" });
      expect(await detector.isAvailable()).toBe(true);
    });

    it("returns false when rocm-smi returns empty output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "not found" });
      expect(await detector.isAvailable()).toBe(false);
    });

    it("caches the result after first call", async () => {
      mockSafeExec.mockResolvedValue({ stdout: productJson, stderr: "" });
      await detector.isAvailable();
      await detector.isAvailable();
      expect(mockSafeExec).toHaveBeenCalledTimes(1);
    });
  });

  describe("detect", () => {
    it("parses multiple AMD GPUs", async () => {
      mockAllResponses();
      const result = await detector.detect();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("AMD Radeon RX 7900 XTX");
      expect(result[0].vendor).toBe("AMD");
      expect(result[0].brand).toBe("RADEON");
      expect(result[0].temperature).toBe(45);
      expect(result[0].usage).toBe(20);
      expect(result[0].vramTotal).toBeCloseTo(24, 1);
      expect(result[0].vramUsed).toBeCloseTo(13.3, 1);
      expect(result[0].pciBusId).toBe("05:00.0");
      expect(result[1].pciBusId).toBe("08:00.0");
      expect(result[1].temperature).toBe(48);
      expect(result[1].usage).toBe(15);
    });

    it("returns empty array on empty product output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });
      const result = await detector.detect();
      expect(result).toEqual([]);
    });

    it("handles malformed JSON gracefully", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "not-json", stderr: "" });
      const result = await detector.detect();
      expect(result).toEqual([]);
    });

    it("fills defaults when temp/usage/mem parse fails", async () => {
      mockSafeExec.mockImplementation(async (cmd: string) => {
        if (cmd.includes("showproductname")) return { stdout: productJson, stderr: "" };
        return { stdout: "", stderr: "" };
      });

      const result = await detector.detect();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("AMD Radeon RX 7900 XTX");
      expect(result[0].temperature).toBe(0);
      expect(result[0].usage).toBe(0);
      expect(result[0].vramTotal).toBe(0);
    });

    it("parses VRAM from bytes to GB", async () => {
      mockAllResponses();
      const result = await detector.detect();

      // 25753026560 bytes = 24 GB
      expect(result[0].vramTotal).toBeCloseTo(24, 1);
      // 14252920832 bytes ≈ 13.3 GB
      expect(result[0].vramUsed).toBeCloseTo(13.3, 1);
    });

    it("uppercases PCI bus ID", async () => {
      mockAllResponses();
      const result = await detector.detect();
      expect(result[0].pciBusId).toBe("05:00.0");
    });
  });
});
