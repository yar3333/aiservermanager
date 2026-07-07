import "reflect-metadata";
import { LspciEnricher } from "../lspciEnricher";
import * as execModule from "../../exec";
import { GpuInfo } from "../../../types";

jest.mock("../../exec");
const mockSafeExec = execModule.safeExec as jest.MockedFunction<typeof execModule.safeExec>;

const lspciOutput = [
  "05:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [1002:744c]",
  "        Subsystem: Micro-Star International Co., Ltd. [MSI] Device [1462:5200]",
  "        Flags: bus master, fast devsel, latency 0, IRQ 77",
  "        Memory at 5000000000 (64-bit, prefetchable) [size=32G]",
  "--",
  "08:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [1002:744c]",
  "        Subsystem: Gigabyte Technology Co., Ltd Device [1458:240e]",
  "        Flags: bus master, fast devsel, latency 0, IRQ 78",
  "        Memory at 4000000000 (64-bit, prefetchable) [size=32G]",
  "--",
  "0d:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [1002:744c]",
  "        Subsystem: Sapphire Technology Limited PULSE RX 7900 XTX [1da2:471e]",
  "        Flags: bus master, fast devsel, latency 0, IRQ 79",
  "        Memory at 7000000000 (64-bit, prefetchable) [size=32G]",
  "--",
  "10:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [1002:744c]",
  "        Subsystem: ASRock Incorporation Radeon RX 7900 XTX [1849:5304]",
  "        Flags: bus master, fast devsel, latency 0, IRQ 80",
  "        Memory at 6000000000 (64-bit, prefetchable) [size=32G]",
].join("\n");

describe("LspciEnricher", () => {
  let enricher: LspciEnricher;

  beforeEach(() => {
    jest.clearAllMocks();
    enricher = new LspciEnricher();
  });

  const gpus: GpuInfo[] = [
    {
      index: 0,
      vendor: "AMD",
      brand: "RADEON",
      name: "AMD Radeon RX 7900 XTX",
      engineCudaName: "",
      engineRocmName: "",
      engineVulkanName: "",
      vramTotal: 24,
      vramUsed: 13,
      usage: 20,
      temperature: 45,
      pciBusId: "05:00.0",
    },
    {
      index: 1,
      vendor: "AMD",
      brand: "RADEON",
      name: "AMD Radeon RX 7900 XTX",
      engineCudaName: "",
      engineRocmName: "",
      engineVulkanName: "",
      vramTotal: 24,
      vramUsed: 14,
      usage: 15,
      temperature: 48,
      pciBusId: "08:00.0",
    },
    {
      index: 2,
      vendor: "AMD",
      brand: "RADEON",
      name: "AMD Radeon RX 7900 XTX",
      engineCudaName: "",
      engineRocmName: "",
      engineVulkanName: "",
      vramTotal: 24,
      vramUsed: 14,
      usage: 18,
      temperature: 47,
      pciBusId: "0D:00.0",
    },
    {
      index: 3,
      vendor: "AMD",
      brand: "RADEON",
      name: "AMD Radeon RX 7900 XTX",
      engineCudaName: "",
      engineRocmName: "",
      engineVulkanName: "",
      vramTotal: 24,
      vramUsed: 20,
      usage: 25,
      temperature: 46,
      pciBusId: "10:00.0",
    },
  ];

  function makeGpus(): GpuInfo[] {
    return gpus.map((g) => ({ ...g }));
  }

  describe("enrich", () => {
    it("detects MSI brand from Micro-Star", async () => {
      mockSafeExec.mockResolvedValue({ stdout: lspciOutput, stderr: "" });
      const testGpus = makeGpus();
      await enricher.enrich(testGpus);
      expect(testGpus[0].brand).toBe("MSI");
    });

    it("detects Gigabyte brand", async () => {
      mockSafeExec.mockResolvedValue({ stdout: lspciOutput, stderr: "" });
      const testGpus = makeGpus();
      await enricher.enrich(testGpus);
      expect(testGpus[1].brand).toBe("GIGABYTE");
    });

    it("detects Sapphire brand", async () => {
      mockSafeExec.mockResolvedValue({ stdout: lspciOutput, stderr: "" });
      const testGpus = makeGpus();
      await enricher.enrich(testGpus);
      expect(testGpus[2].brand).toBe("SAPPHIRE");
    });

    it("detects ASRock brand", async () => {
      mockSafeExec.mockResolvedValue({ stdout: lspciOutput, stderr: "" });
      const testGpus = makeGpus();
      await enricher.enrich(testGpus);
      expect(testGpus[3].brand).toBe("ASROCK");
    });

    it("handles empty output gracefully", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });
      const testGpus = makeGpus();
      await enricher.enrich(testGpus);
      expect(testGpus[0].brand).toBe("RADEON"); // unchanged
    });

    it("handles empty gpu list", async () => {
      mockSafeExec.mockResolvedValue({ stdout: lspciOutput, stderr: "" });
      await enricher.enrich([]);
      expect(mockSafeExec).not.toHaveBeenCalled();
    });

    it("is not available on non-linux", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });
      const winEnricher = new LspciEnricher();
      Object.defineProperty(process, "platform", { value: originalPlatform });
      expect(winEnricher.isAvailable()).resolves.toBe(false);
    });
  });
});
