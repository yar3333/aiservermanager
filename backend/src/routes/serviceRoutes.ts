import { Request, Response, Router } from "express";
import { Container } from "inversify";
import { SERVICE_MANAGER, SERVICE_CONFIG_CONTROLLER } from "../di/types";
import { ServiceManager } from "../services/serviceManager";
import { ServiceConfigController } from "../services/serviceConfigController";
import { ServiceAction } from "../models/ServiceStatus";
import { ServiceConfig } from "../models/ServiceConfig";

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

  /** List all user-created service configs. */
  router.get("/config", (_req, res) => {
    try {
      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      res.json(scc.listConfigs());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Get a single service config by suffix. */
  router.get("/config/:suffix", (req: Request, res: Response) => {
    try {
      const suffix = Array.isArray(req.params.suffix) ? req.params.suffix[0] : req.params.suffix;
      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      const cfg = scc.getConfig(suffix);
      if (!cfg) {
        return res.status(404).json({ error: `Config "${suffix}" not found` });
      }
      res.json(cfg);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Create or update a service config. */
  router.post("/config", async (req: Request, res: Response) => {
    try {
      const body: Partial<ServiceConfig> = req.body;

      if (!body.suffix || !body.command) {
        return res.status(400).json({ error: "Both 'suffix' and 'command' are required" });
      }

      const cfg: ServiceConfig = {
        suffix: body.suffix,
        command: body.command,
        flags: body.flags ?? {},
      };

      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      const result = await scc.createOrUpdate(cfg);

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }

      res.status(201).json(result.config);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Delete a service config and its systemd unit. */
  router.delete("/config/:suffix", async (req: Request, res: Response) => {
    try {
      const suffix = Array.isArray(req.params.suffix) ? req.params.suffix[0] : req.params.suffix;
      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      const result = await scc.deleteService(suffix);

      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
