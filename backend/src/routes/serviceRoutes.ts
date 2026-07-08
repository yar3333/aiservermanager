import { Request, Response, Router } from "express";
import { Container } from "inversify";
import { SERVICE_MANAGER } from "../di/types";
import { ServiceManager } from "../services/serviceManager";
import { ServiceAction } from "../models/ServiceStatus";

export default function serviceRoutes(container: Container) {
  const router = Router();

  /** Get status of all managed services. */
  router.get("/", async (_req, res) => {
    try {
      const sm = container.get<ServiceManager>(SERVICE_MANAGER);
      const statusList = await sm.getStatusList();
      res.json(statusList);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Perform an action on a named service: { name: "llama", action: "start" } */
  router.post("/control", async (req: Request, res: Response) => {
    try {
      const { name, action } = req.body;

      if (!name || !action) {
        return res.status(400).json({ error: "Both 'name' and 'action' are required" });
      }

      if (!["start", "stop", "enable", "disable"].includes(action)) {
        return res.status(400).json({ error: `Invalid action: ${action}` });
      }

      const sm = container.get<ServiceManager>(SERVICE_MANAGER);
      const result = await sm.performAction(name, action as ServiceAction);
      res.json(result);
    } catch (err) {
      const status = (err as Error).message.startsWith("Unknown service") ? 404 : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
