import "reflect-metadata";
import { PciBusOrderIndexResolver } from "../pciBusOrderIndexResolver";
import { GpuInfo } from "../../../models/GpuInfo";

function makeGpu(pciBusId: string, name = "AMD Radeon RX 7900 XTX"): GpuInfo {
  return { index: 0, vendor: "AMD", brand: "RADEON", name, gpuIndex: 0, vramTotal: 24, pciBusId };
}

describe("PciBusOrderIndexResolver", () => {
  let resolver: PciBusOrderIndexResolver;

  beforeEach(() => {
    resolver = new PciBusOrderIndexResolver();
  });

  describe("isAvailable", () => {
    it("returns true on any platform", async () => {
      expect(await resolver.isAvailable()).toBe(true);
    });
  });

  describe("resolve", () => {
    it("assigns indices by BDF order — the user's 4x 7900 XTX case", async () => {
      // Input in HIP (kernel probe) order — the resolver must re-sort by BDF
      const gpus = [makeGpu("C3:00.0"), makeGpu("C6:00.0"), makeGpu("83:00.0"), makeGpu("86:00.0")];

      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(4);
      expect(gpus.find((g) => g.pciBusId === "83:00.0")?.gpuIndex).toBe(0);
      expect(gpus.find((g) => g.pciBusId === "86:00.0")?.gpuIndex).toBe(1);
      expect(gpus.find((g) => g.pciBusId === "C3:00.0")?.gpuIndex).toBe(2);
      expect(gpus.find((g) => g.pciBusId === "C6:00.0")?.gpuIndex).toBe(3);
    });

    it("sorts buses numerically, not lexicographically", async () => {
      // 0x09 < 0x0F < 0x10; lexicographically "0F" would come first
      const gpus = [makeGpu("10:00.0"), makeGpu("9:00.0"), makeGpu("0F:00.0")];

      await resolver.resolve(gpus);

      expect(gpus.find((g) => g.pciBusId === "9:00.0")?.gpuIndex).toBe(0);
      expect(gpus.find((g) => g.pciBusId === "0F:00.0")?.gpuIndex).toBe(1);
      expect(gpus.find((g) => g.pciBusId === "10:00.0")?.gpuIndex).toBe(2);
    });

    it("orders by device and function within the same bus", async () => {
      const gpus = [makeGpu("83:01.0"), makeGpu("83:00.1"), makeGpu("83:00.0")];

      await resolver.resolve(gpus);

      expect(gpus.find((g) => g.pciBusId === "83:00.0")?.gpuIndex).toBe(0);
      expect(gpus.find((g) => g.pciBusId === "83:00.1")?.gpuIndex).toBe(1);
      expect(gpus.find((g) => g.pciBusId === "83:01.0")?.gpuIndex).toBe(2);
    });

    it("parses the 'DDDD:BB:DD.F' form with domain prefix", async () => {
      const gpus = [makeGpu("0000:C3:00.0"), makeGpu("83:00.0")];

      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(2);
      expect(gpus.find((g) => g.pciBusId === "83:00.0")?.gpuIndex).toBe(0);
      expect(gpus.find((g) => g.pciBusId === "0000:C3:00.0")?.gpuIndex).toBe(1);
    });

    it("is case-insensitive", async () => {
      const gpus = [makeGpu("c6:00.0"), makeGpu("C3:00.0")];

      await resolver.resolve(gpus);

      expect(gpus.find((g) => g.pciBusId === "C3:00.0")?.gpuIndex).toBe(0);
      expect(gpus.find((g) => g.pciBusId === "c6:00.0")?.gpuIndex).toBe(1);
    });

    it("appends GPUs without a parseable pciBusId after the sorted ones, in list order", async () => {
      const noBus = makeGpu("");
      const pnpId = makeGpu("PCI\\VEN_1002&DEV_744C&SUBSYS_01341DA2\\4&2a1b2c3d&0&008");
      const gpus = [makeGpu("C3:00.0"), noBus, makeGpu("83:00.0"), pnpId];

      const assigned = await resolver.resolve(gpus);

      expect(assigned).toBe(4);
      expect(gpus.find((g) => g.pciBusId === "83:00.0")?.gpuIndex).toBe(0);
      expect(gpus.find((g) => g.pciBusId === "C3:00.0")?.gpuIndex).toBe(1);
      expect(noBus.gpuIndex).toBe(2);
      expect(pnpId.gpuIndex).toBe(3);
    });

    it("returns 0 for an empty list", async () => {
      expect(await resolver.resolve([])).toBe(0);
    });
  });
});
