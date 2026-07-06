import request from "supertest";
import express from "express";
import gpuRoutes from "../gpuRoutes";
import * as gpuService from "../../services/gpuService";

// Mock the gpuService
jest.mock("../../services/gpuService");
const mockGetGpuList = gpuService.getGpuList as jest.MockedFunction<typeof gpuService.getGpuList>;

const app = express();
app.use(express.json());
app.use("/api/gpus", gpuRoutes);

describe("GET /api/gpus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with GPU list", async () => {
    mockGetGpuList.mockResolvedValue([
      {
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
      },
    ]);

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("GeForce RTX 3080");
  });

  it("returns empty array when no GPUs found", async () => {
    mockGetGpuList.mockResolvedValue([]);

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 when service throws", async () => {
    mockGetGpuList.mockRejectedValue(new Error("nvidia-smi failed"));

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("nvidia-smi failed");
  });

  it("returns 500 with generic message for non-Error throw", async () => {
    mockGetGpuList.mockRejectedValue("string error");

    const res = await request(app).get("/api/gpus");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Unknown error");
  });
});
