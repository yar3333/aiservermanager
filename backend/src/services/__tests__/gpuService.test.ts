import "reflect-metadata";
import { Container } from "inversify";
import { GPU_DETECTOR, GPU_ENRICHER, GPU_INDEX_RESOLVER, GPU_SERVICE, GPU_USAGE_PROBE } from "../../di/types";
import { GpuDetector } from "../detectors/gpuDetector";
import { GpuEnricher } from "../enrichers/gpuEnricher";
import { GpuUsageProbe } from "../probes/gpuUsageProbe";
import { GpuIndexResolver } from "../resolvers/gpuIndexResolver";
import { GpuService } from "../gpuService";
import { GpuInfo, GpuUsage } from "../../models/GpuInfo";

function createTestContainer(
  detectors: PartialMockDetector[] = [],
  enrichers: PartialMockEnricher[] = [],
  probes: PartialMockProbe[] = [],
  indexResolvers: PartialMockResolver[] = [],
): Container {
  const container = new Container();

  for (const d of detectors) {
    container.bind<GpuDetector>(GPU_DETECTOR).toConstantValue(d as unknown as GpuDetector);
  }
  for (const e of enrichers) {
    container.bind<GpuEnricher>(GPU_ENRICHER).toConstantValue(e as unknown as GpuEnricher);
  }
  for (const p of probes) {
    container.bind<GpuUsageProbe>(GPU_USAGE_PROBE).toConstantValue(p as unknown as GpuUsageProbe);
  }
  for (const r of indexResolvers) {
    container.bind<GpuIndexResolver>(GPU_INDEX_RESOLVER).toConstantValue(r as unknown as GpuIndexResolver);
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

type PartialMockProbe = {
  isAvailable: jest.Mock;
  probe: jest.Mock;
};

type PartialMockResolver = {
  isAvailable: jest.Mock;
  resolve: jest.Mock;
};

function makeMockDetector(): PartialMockDetector {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    detect: jest.fn().mockResolvedValue([]),
  };
}

function makeMockProbe(): PartialMockProbe {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    probe: jest.fn().mockResolvedValue([]),
  };
}

/** Resolver mock that assigns nothing (simulates no match). */
function makeMockResolver(assigned = 0): PartialMockResolver {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    resolve: jest.fn().mockResolvedValue(assigned),
  };
}

const gpu1: GpuInfo = {
  index: 0,
  vendor: "NVIDIA",
  brand: "NVIDIA",
  name: "GeForce RTX 3080",
  gpuIndex: 0,
  vramTotal: 10,
  pciBusId: "1:00.0",
};

const gpu1Lean: GpuInfo = {
  index: 0,
  vendor: "NVIDIA",
  brand: "NVIDIA",
  name: "GeForce RTX 3080",
  gpuIndex: 0,
  vramTotal: 0,
  pciBusId: "1:00.0",
};

const gpu2: GpuInfo = {
  index: 1,
  vendor: "AMD",
  brand: "RADEON",
  name: "Radeon RX 6800",
  gpuIndex: 0,
  vramTotal: 16,
  pciBusId: "2:00.0",
};

const usage1: GpuUsage = {
  key: "1:00.0",
  usage: 50,
  temperature: 72,
  vramUsed: 4,
};

describe("GpuService", () => {
  let container: Container;

  describe("getStaticGpus", () => {
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
      const result = await service.getStaticGpus();

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
      await service.getStaticGpus();

      expect(det1.detect).not.toHaveBeenCalled();
      expect(det2.detect).toHaveBeenCalled();
    });

    it("deduplicates GPUs with the same pciBusId", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.detect.mockResolvedValue([gpu1]);
      det2.detect.mockResolvedValue([gpu1Lean]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getStaticGpus();

      expect(result).toHaveLength(1);
      expect(result[0].vramTotal).toBe(10);
    });

    it("caches result after first call", async () => {
      const det1 = makeMockDetector();
      det1.detect.mockResolvedValue([gpu1]);

      container = createTestContainer([det1]);
      const service = container.get<GpuService>(GPU_SERVICE);

      await service.getStaticGpus();
      await service.getStaticGpus();

      expect(det1.detect).toHaveBeenCalledTimes(1);
    });

    it("does not cache empty result — retries on next call", async () => {
      const det1 = makeMockDetector();
      det1.detect.mockResolvedValueOnce([]).mockResolvedValueOnce([gpu1]);

      container = createTestContainer([det1]);
      const service = container.get<GpuService>(GPU_SERVICE);

      const first = await service.getStaticGpus();
      expect(first).toEqual([]);

      const second = await service.getStaticGpus();
      expect(second).toHaveLength(1);
      expect(det1.detect).toHaveBeenCalledTimes(2);
    });

    it("returns empty array when no detectors are available", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.isAvailable.mockResolvedValue(false);
      det2.isAvailable.mockResolvedValue(false);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getStaticGpus();

      expect(result).toEqual([]);
    });
  });

  describe("index resolution", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("assigns gpuIndex via the first resolver that matches and sorts by it", async () => {
      // Detector reports GPUs in BDF order (not HIP order)
      const det = makeMockDetector();
      det.detect.mockResolvedValue([
        { ...gpu1, pciBusId: "83:00.0" },
        { ...gpu1, index: 1, pciBusId: "86:00.0" },
        { ...gpu1, index: 2, pciBusId: "C3:00.0" },
        { ...gpu1, index: 3, pciBusId: "C6:00.0" },
      ]);

      // Sysfs-style resolver: card order = HIP order
      const sysfsResolver = {
        isAvailable: jest.fn().mockResolvedValue(true),
        resolve: jest.fn((gpus: GpuInfo[]) => {
          const order: Record<string, number> = { "C3:00.0": 0, "C6:00.0": 1, "83:00.0": 2, "86:00.0": 3 };
          gpus.forEach((g) => {
            g.gpuIndex = order[g.pciBusId] ?? 0;
          });
          return Promise.resolve(gpus.length);
        }),
      };
      const fallbackResolver = makeMockResolver();

      container = createTestContainer([det], [], [], [sysfsResolver as unknown as PartialMockResolver, fallbackResolver]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getStaticGpus();

      expect(result.map((g) => g.pciBusId)).toEqual(["C3:00.0", "C6:00.0", "83:00.0", "86:00.0"]);
      expect(result.map((g) => g.gpuIndex)).toEqual([0, 1, 2, 3]);
      // Fallback resolver must not run once the first one matched
      expect(fallbackResolver.resolve).not.toHaveBeenCalled();
    });

    it("falls back to the next resolver when one matches nothing", async () => {
      const det = makeMockDetector();
      det.detect.mockResolvedValue([{ ...gpu1 }, { ...gpu1, index: 1, pciBusId: "2:00.0" }]);

      const noMatchResolver = makeMockResolver(0);
      const listOrderResolver = {
        isAvailable: jest.fn().mockResolvedValue(true),
        resolve: jest.fn((gpus: GpuInfo[]) => {
          gpus.forEach((g, i) => {
            g.gpuIndex = i;
          });
          return Promise.resolve(gpus.length);
        }),
      };

      container = createTestContainer([det], [], [], [
        noMatchResolver,
        listOrderResolver as unknown as PartialMockResolver,
      ]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getStaticGpus();

      expect(noMatchResolver.resolve).toHaveBeenCalled();
      expect(listOrderResolver.resolve).toHaveBeenCalled();
      expect(result.map((g) => g.gpuIndex)).toEqual([0, 1]);
    });

    it("skips resolvers that are not available", async () => {
      const det = makeMockDetector();
      det.detect.mockResolvedValue([gpu1]);

      const unavailableResolver = makeMockResolver(5);
      unavailableResolver.isAvailable.mockResolvedValue(false);

      container = createTestContainer([det], [], [], [unavailableResolver]);
      const service = container.get<GpuService>(GPU_SERVICE);
      await service.getStaticGpus();

      expect(unavailableResolver.resolve).not.toHaveBeenCalled();
    });
  });

  describe("deduplication scoring (static)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("prefers entry with vramTotal over entry without (same pciBusId)", async () => {
      const det1 = makeMockDetector();
      const det2 = makeMockDetector();
      det1.detect.mockResolvedValue([gpu1Lean]);
      det2.detect.mockResolvedValue([gpu1]);

      container = createTestContainer([det1, det2]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getStaticGpus();

      expect(result).toHaveLength(1);
      expect(result[0].vramTotal).toBe(10);
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
      const result = await service.getStaticGpus();

      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(gpuA.index);
    });
  });

  describe("getUsage", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns usage from probes", async () => {
      const det = makeMockDetector();
      const probe = makeMockProbe();
      det.detect.mockResolvedValue([gpu1]);
      probe.probe.mockResolvedValue([usage1]);

      container = createTestContainer([det], [], [probe]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getUsage();

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("1:00.0");
      expect(result[0].usage).toBe(50);
    });

    it("skips probes that are not available", async () => {
      const det = makeMockDetector();
      const probe = makeMockProbe();
      probe.isAvailable.mockResolvedValue(false);
      det.detect.mockResolvedValue([gpu1]);

      container = createTestContainer([det], [], [probe]);
      const service = container.get<GpuService>(GPU_SERVICE);
      const result = await service.getUsage();

      expect(result).toEqual([]);
      expect(probe.probe).not.toHaveBeenCalled();
    });
  });
});
