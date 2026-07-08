import { Router } from "express";
import { Container } from "inversify";
import { GPU_SERVICE } from "../di/types";
import { GpuService } from "../services/gpuService";

export default function gpuRoutes(container: Container) {
  const router = Router();

  /** Static GPU info — call once on frontend init. */
  router.get("/", async (_req, res) => {
    try {
      const gpuService = container.get<GpuService>(GPU_SERVICE);
      const gpus = await gpuService.getStaticGpus();
      res.json(gpus);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Dynamic usage metrics — polled every few seconds. */
  router.get("/usage", async (_req, res) => {
    try {
      const gpuService = container.get<GpuService>(GPU_SERVICE);
      const usage = await gpuService.getUsage();
      res.json(usage);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
