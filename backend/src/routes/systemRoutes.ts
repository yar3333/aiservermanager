import { Router } from "express";
import { Container } from "inversify";
import { SYSTEM_SERVICE } from "../di/types";
import { SystemService } from "../services/systemService";

export default function systemRoutes(container: Container) {
  const router = Router();

  /** System info — CPU usage + memory. */
  router.get("/", async (_req, res) => {
    try {
      const systemService = container.get<SystemService>(SYSTEM_SERVICE);
      const info = await systemService.getSystemInfo();
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
