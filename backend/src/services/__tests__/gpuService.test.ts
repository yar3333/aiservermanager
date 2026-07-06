import { GpuInfo } from "../../types";

// Use module-level WeakMaps to share mock instances across the module boundary
const mockInstances = {
  nvidia: null as { isAvailable: jest.Mock; detect: jest.Mock } | null,
  wmi: null as { isAvailable: jest.Mock; detect: jest.Mock } | null,
};

jest.mock("../detectors/nvidiaSmiDetector", () => {
  return {
    NvidiaSmiDetector: jest.fn(() => {
      return mockInstances.nvidia;
    }),
  };
});
jest.mock("../detectors/wmiDetector", () => {
  return {
    WmiDetector: jest.fn(() => {
      return mockInstances.wmi;
    }),
  };
});
jest.mock("../detectors/amdLinuxDetector", () => ({
  AmdLinuxDetector: jest.fn(() => ({
    isAvailable: jest.fn().mockResolvedValue(false),
    detect: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock("../enrichers/lspciEnricher", () => ({
  LspciEnricher: jest.fn(() => ({
    isAvailable: jest.fn().mockResolvedValue(false),
    enrich: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock("../enrichers/vulkanEnricher", () => ({
  VulkanEnricher: jest.fn(() => ({
    isAvailable: jest.fn().mockResolvedValue(false),
    enrich: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Now import GpuService (imports happen after jest.mock is hoisted)
import { GpuService } from "../gpuService";

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
  pciBusId: "",
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

function makeMockDetector() {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    detect: jest.fn().mockResolvedValue([]),
  };
}

describe("GpuService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstances.nvidia = makeMockDetector();
    mockInstances.wmi = makeMockDetector();
  });

  describe("getGpuList", () => {
    it("calls detectors sequentially and returns merged results", async () => {
      mockInstances.nvidia!.detect.mockResolvedValue([gpu1]);
      mockInstances.wmi!.detect.mockResolvedValue([gpu2]);

      const service = new GpuService();
      const result = await service.getGpuList();

      expect(mockInstances.nvidia!.isAvailable).toHaveBeenCalled();
      expect(mockInstances.nvidia!.detect).toHaveBeenCalled();
      expect(mockInstances.wmi!.isAvailable).toHaveBeenCalled();
      expect(mockInstances.wmi!.detect).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });

    it("skips detectors that are not available", async () => {
      mockInstances.nvidia!.isAvailable.mockResolvedValue(false);
      mockInstances.wmi!.detect.mockResolvedValue([gpu2]);

      const service = new GpuService();
      await service.getGpuList();

      expect(mockInstances.nvidia!.detect).not.toHaveBeenCalled();
      expect(mockInstances.wmi!.detect).toHaveBeenCalled();
    });

    it("deduplicates GPUs with the same name", async () => {
      mockInstances.nvidia!.detect.mockResolvedValue([gpu1]);
      mockInstances.wmi!.detect.mockResolvedValue([gpu1Lean]);

      const service = new GpuService();
      const result = await service.getGpuList();

      expect(result).toHaveLength(1);
      // Should keep the entry with more data (gpu1 has usage, temperature, vramUsed)
      expect(result[0].usage).toBe(50);
      expect(result[0].temperature).toBe(72);
    });

    it("returns empty array when no detectors are available", async () => {
      mockInstances.nvidia!.isAvailable.mockResolvedValue(false);
      mockInstances.wmi!.isAvailable.mockResolvedValue(false);

      const service = new GpuService();
      const result = await service.getGpuList();

      expect(result).toEqual([]);
    });
  });

  describe("deduplication scoring", () => {
    it("prefers entry with usage and temperature over lean entry", async () => {
      mockInstances.nvidia!.detect.mockResolvedValue([gpu1Lean]);
      mockInstances.wmi!.detect.mockResolvedValue([gpu1]);

      const service = new GpuService();
      const result = await service.getGpuList();

      expect(result).toHaveLength(1);
      expect(result[0].usage).toBe(50);
    });

    it("keeps first entry when scores are equal", async () => {
      const gpuA: GpuInfo = { ...gpu1, name: "Unique GPU A" };
      const gpuB: GpuInfo = { ...gpu1, name: "Unique GPU A" };

      mockInstances.nvidia!.detect.mockResolvedValue([gpuA]);
      mockInstances.wmi!.detect.mockResolvedValue([gpuB]);

      const service = new GpuService();
      const result = await service.getGpuList();

      expect(result).toHaveLength(1);
      expect(result[0].index).toBe(gpuA.index);
    });
  });
});
