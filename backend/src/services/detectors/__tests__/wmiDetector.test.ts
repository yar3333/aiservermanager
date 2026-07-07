import { WmiDetector } from "../wmiDetector";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("../../../helpers/ExecTools");
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

describe("WmiDetector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createDetector(platform: NodeJS.Platform = "win32"): WmiDetector {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    const d = new WmiDetector();
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    return d;
  }

  describe("isAvailable", () => {
    it("returns true when WMI returns data", async () => {
      const detector = createDetector();
      mockSafeExec.mockResolvedValue({ stdout: '{"Name":"test"}', stderr: "" });

      expect(await detector.isAvailable()).toBe(true);
    });

    it("returns false on non-Windows", async () => {
      const detector = createDetector("linux");
      expect(await detector.isAvailable()).toBe(false);
    });
  });

  describe("detect", () => {
    it("parses NVIDIA GPU from WMI JSON", async () => {
      const detector = createDetector();
      const wmiJson = JSON.stringify([
        { name: "NVIDIA GeForce RTX 3080", vram: "8589934592", pci: "PCI\\VEN_10DE&DEV_2206" },
      ]);
      mockSafeExec.mockResolvedValue({ stdout: wmiJson, stderr: "" });

      const gpus = await detector.detect();
      expect(gpus).toHaveLength(1);
      expect(gpus[0]).toMatchObject({
        index: 0,
        vendor: "NVIDIA",
        brand: "NVIDIA",
        name: "NVIDIA GeForce RTX 3080",
        vramTotal: 8,
        usage: 0,
        temperature: 0,
        pciBusId: "PCI\\VEN_10DE&DEV_2206",
      });
    });

    it("parses AMD GPU from WMI JSON", async () => {
      const detector = createDetector();
      const wmiJson = JSON.stringify([
        { name: "AMD Radeon RX 6800", vram: "16106127360", pci: "PCI\\VEN_1002&DEV_7340" },
      ]);
      mockSafeExec.mockResolvedValue({ stdout: wmiJson, stderr: "" });

      const gpus = await detector.detect();
      expect(gpus[0].vendor).toBe("AMD");
      expect(gpus[0].brand).toBe("RADEON");
    });

    it("parses Intel GPU from WMI JSON", async () => {
      const detector = createDetector();
      const wmiJson = JSON.stringify([
        { name: "Intel(R) UHD Graphics", vram: "1073741824", pci: "PCI\\VEN_8086&DEV_9BC4" },
      ]);
      mockSafeExec.mockResolvedValue({ stdout: wmiJson, stderr: "" });

      const gpus = await detector.detect();
      expect(gpus[0].vendor).toBe("Intel");
    });

    it("returns empty array on malformed JSON", async () => {
      const detector = createDetector();
      mockSafeExec.mockResolvedValue({ stdout: "not json at all", stderr: "" });

      const gpus = await detector.detect();
      expect(gpus).toEqual([]);
    });

    it("returns empty array on empty output", async () => {
      const detector = createDetector();
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });

      const gpus = await detector.detect();
      expect(gpus).toEqual([]);
    });

    it("handles single object (not array) from WMI", async () => {
      const detector = createDetector();
      const wmiJson = JSON.stringify({ name: "NVIDIA GeForce GTX 1660", vram: "4294967296", pci: "PCI\\VEN_10DE" });
      mockSafeExec.mockResolvedValue({ stdout: wmiJson, stderr: "" });

      const gpus = await detector.detect();
      expect(gpus).toHaveLength(1);
      expect(gpus[0].name).toBe("NVIDIA GeForce GTX 1660");
    });
  });

  describe("classifyVendor", () => {
    it.each([
      ["NVIDIA GeForce RTX 3080", "NVIDIA"],
      ["AMD Radeon RX 6800", "AMD"],
      ["Intel(R) UHD Graphics", "Intel"],
      ["Some Unknown GPU", "Unknown"],
    ])("classifies '%s' as '%s'", async (name: string, expected: string) => {
      const detector = createDetector();
      const wmiJson = JSON.stringify([{ name, vram: "0", pci: "" }]);
      mockSafeExec.mockResolvedValue({ stdout: wmiJson, stderr: "" });

      const gpus = await detector.detect();
      expect(gpus[0].vendor).toBe(expected);
    });
  });
});
