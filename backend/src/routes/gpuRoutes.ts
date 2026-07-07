import { Router } from "express";
import { Container } from "inversify";
import { GPU_SERVICE } from "../di/types";
import { GpuService } from "../services/gpuService";

export default function gpuRoutes(container: Container) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const gpuService = container.get<GpuService>(GPU_SERVICE);
      const gpus = await gpuService.getGpuList();
      res.json(gpus);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
