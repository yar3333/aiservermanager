import { Router } from "express";
import { Container } from "inversify";
import { GPU_SERVICE, SYSTEM_SERVICE } from "../di/types";
import { GpuService } from "../services/gpuService";
import { SystemService } from "../services/systemService";

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

  /** Dynamic usage metrics + system info — polled every few seconds. */
  router.get("/usage", async (_req, res) => {
    try {
      const [gpuService, systemService] = [
        container.get<GpuService>(GPU_SERVICE),
        container.get<SystemService>(SYSTEM_SERVICE),
      ];
      const [gpus, system] = await Promise.all([gpuService.getUsage(), systemService.getSystemInfo()]);
      res.json({ gpus, system });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
