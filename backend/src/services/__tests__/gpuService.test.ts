import "reflect-metadata";
import { Container } from "inversify";
import { GPU_DETECTOR, GPU_ENRICHER, GPU_SERVICE } from "../../di/types";
import { GpuDetector } from "../detectors/gpuDetector";
import { GpuEnricher } from "../enrichers/gpuEnricher";
import { GpuService } from "../gpuService";
import { GpuInfo } from "../../types";

function createTestContainer(detectors: PartialMockDetector[] = [], enrichers: PartialMockEnricher[] = []): Container {
  const container = new Container();

  for (const d of detectors) {
    container.bind<GpuDetector>(GPU_DETECTOR).toConstantValue(d as unknown as GpuDetector);
  }
  for (const e of enrichers) {
    container.bind<GpuEnricher>(GPU_ENRICHER).toConstantValue(e as unknown as GpuEnricher);
  }

  container.bind<GpuService>(GPU_SERVICE).to(GpuService);

  return container;
}

type PartialMockDetector = {
  isAvailable: jest.Mock;
  detect: jest.Mock;
};

type PartialMockEnricher = {
  isAvailable: jest.Mock;
  enrich: jest.Mock;
};

function makeMockDetector(): PartialMockDetector {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    detect: jest.fn().mockResolvedValue([]),
  };
}

const gpu1: GpuInfo = {
  index: 0,
  vendor: "NVIDIA",
  brand: "NVIDIA",
  name: "GeForce RTX 3080",
  vulkanName: "",
  vramTotal: 10,
  vramUsed: 4,
  usage: 50,
  temperature: 72,
  pciBusId: "1:00.0",
};

const gpu1Lean: GpuInfo = {
  index: 0,
  vendor: "NVIDIA",
  brand: "NVIDIA",
  name: "GeForce RTX 3080",
  vulkanName: "",
  vramTotal: 0,
  vramUsed: 0,
  usage: 0,
  temperature: 0,
  pciBusId: "1:00.0",
};

const gpu2: GpuInfo = {
  index: 1,
  vendor: "AMD",
  brand: "RADEON",
  name: "Radeon RX 6800",
  vulkanName: "",
  vramTotal: 16,
  vramUsed: 2,
  usage: 30,
  temperature: 60,
  pciBusId: "2:00.0",
};

describe("GpuService", () => {
  let container: Container;

  describe("getGpuList", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("calls detectors sequentially and returns merged results", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.detect.mockResolvedValue([gpu1]);
      det2.detect.mockResolvedValue([gpu2]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getGpuList();

      expect(det1.isAvailable).toHaveBeenCalled();
      expect(det1.detect).toHaveBeenCalled();
      expect(det2.isAvailable).toHaveBeenCalled();
      expect(det2.detect).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it("skips detectors that are not available", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.isAvailable.mockResolvedValue(false);
      det2.detect.mockResolvedValue([gpu2]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      await service.getGpuList();

      expect(det1.detect).not.toHaveBeenCalled();
      expect(det2.detect).toHaveBeenCalled();
    });

    it("deduplicates GPUs with the same name", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.detect.mockResolvedValue([gpu1]);
      det2.detect.mockResolvedValue([gpu1Lean]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getGpuList();

      expect(result).toHaveLength(1);
      // Should keep the entry with more data (gpu1 has usage, temperature, vramUsed)
      expect(result[0].usage).toBe(50);
      expect(result[0].temperature).toBe(72);
    });

    it("returns empty array when no detectors are available", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.isAvailable.mockResolvedValue(false);
      det2.isAvailable.mockResolvedValue(false);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getGpuList();

      expect(result).toEqual([]);
    });
  });

  describe("deduplication scoring", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("prefers entry with usage and temperature over lean entry", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.detect.mockResolvedValue([gpu1Lean]);
      det2.detect.mockResolvedValue([gpu1]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getGpuList();

      expect(result).toHaveLength(1);
      expect(result[0].usage).toBe(50);
    });

    it("keeps first entry when scores are equal", async () => {
      const gpuA: GpuInfo = { ...gpu1, name: "Unique GPU A" };
      const gpuB: GpuInfo = { ...gpu1, name: "Unique GPU A" };

      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.detect.mockResolvedValue([gpuA]);
      det2.detect.mockResolvedValue([gpuB]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getGpuList();

      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(gpuA.index);
    });
  });
});
