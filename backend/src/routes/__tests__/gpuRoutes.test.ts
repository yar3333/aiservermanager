import "reflect-metadata";
import request from "supertest";
import express from "express";
import { Container } from "inversify";
import { GPU_SERVICE } from "../../di/types";
import { GpuService } from "../../services/gpuService";
import gpuRoutes from "../gpuRoutes";

// Mock GpuService
const mockGetStaticGpus = jest.fn();
const mockGetUsage = jest.fn();
const mockGpuService = {
  getStaticGpus: mockGetStaticGpus,
  getUsage: mockGetUsage,
} as unknown as GpuService;

function createMockContainer(): Container {
  const container = new Container();
  container.bind<GpuService>(GPU_SERVICE).toConstantValue(mockGpuService);
  return container;
}

const container = createMockContainer();
const app = express();
app.use(express.json());
app.use("/api/gpus", gpuRoutes(container));

describe("GET /api/gpus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with static GPU list", async () => {
    mockGetStaticGpus.mockResolvedValue([
      {
        index: 0,
        vendor: "NVIDIA",
        brand: "NVIDIA",
        name: "GeForce RTX 3080",
        engineCudaName: "cuda0",
        engineRocmName: "",
        engineVulkanName: "",
        vramTotal: 10,
        pciBusId: "1:00.0",
      },
    ]);

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("GeForce RTX 3080");
  });

  it("returns empty array when no GPUs found", async () => {
    mockGetStaticGpus.mockResolvedValue([]);

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 when service throws", async () => {
    mockGetStaticGpus.mockRejectedValue(new Error("nvidia-smi failed"));

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("nvidia-smi failed");
  });
});

describe("GET /api/gpus/usage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with usage metrics", async () => {
    mockGetUsage.mockResolvedValue([{ key: "1:00.0", usage: 50, temperature: 72, vramUsed: 4 }]);

    const res = await request(app).get("/api/gpus/usage");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].usage).toBe(50);
  });

  it("returns 500 when service throws", async () => {
    mockGetUsage.mockRejectedValue(new Error("probe failed"));

    const res = await request(app).get("/api/gpus/usage");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("probe failed");
  });
});
