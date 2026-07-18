import { Request, Response, Router } from "express";
import { Container } from "inversify";
import {
  SERVICE_MANAGER,
  SERVICE_CONFIG_CONTROLLER,
  MANAGED_SERVICES_CONTROLLER,
  LLAMA_AUTOCOMPLETE_SERVICE,
  GPU_SERVICE,
} from "../di/types";
import { ServiceManager } from "../services/serviceManager";
import { ServiceConfigController } from "../services/serviceConfigController";
import { ManagedServicesController } from "../services/managedServicesController";
import { LlamaAutocompleteService, AutocompleteType } from "../services/llamaAutocompleteService";
import { GpuService } from "../services/gpuService";
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

  /** Install a custom service from config and enable it: { name: "llama-server" } */
  router.post("/install", async (req: Request, res: Response) => {
    try {
      const { name } = req.body;

      if (!name) {
        return res.status(400).json({ error: "'name' is required" });
      }

      const sm = container.get<ServiceManager>(SERVICE_MANAGER);
      const result = await sm.installAndEnable(name);
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const status = msg.toLowerCase().includes("not found") ? 404 : 500;
      res.status(status).json({ error: msg });
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

  /** Get a single service config by name. */
  router.get("/config/:name", (req: Request, res: Response) => {
    try {
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      const cfg = scc.getConfig(name);
      if (!cfg) {
        return res.status(404).json({ error: `Config "${name}" not found` });
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

      if (!body.name || !body.command) {
        return res.status(400).json({ error: "Both 'name' and 'command' are required" });
      }

      const cfg: ServiceConfig = {
        name: body.name,
        type: body.type,
        command: body.command,
        flags: body.flags ?? [],
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
  router.delete("/config/:name", async (req: Request, res: Response) => {
    try {
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      const result = await scc.deleteService(name);

      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** List all installed services on the system (excludes custom). */
  router.get("/managed/available", async (_req, res) => {
    try {
      const msc = container.get<ManagedServicesController>(MANAGED_SERVICES_CONTROLLER);
      const available = await msc.listAvailable();
      res.json(available);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** List the user-selected managed service names. */
  router.get("/managed", (_req, res) => {
    try {
      const msc = container.get<ManagedServicesController>(MANAGED_SERVICES_CONTROLLER);
      res.json(msc.listManaged());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Add a service to the managed list: { name: "docker" } */
  router.post("/managed", async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "'name' is required" });
      }

      const msc = container.get<ManagedServicesController>(MANAGED_SERVICES_CONTROLLER);
      const result = msc.addManaged(name);

      if (!result.ok) {
        return res.status(409).json({ error: result.error });
      }

      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Remove a service from the managed list: { name: "docker" } */
  router.delete("/managed", async (req: Request, res: Response) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "'name' is required" });
      }

      const msc = container.get<ManagedServicesController>(MANAGED_SERVICES_CONTROLLER);
      const result = msc.removeManaged(name);

      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Llama autocomplete suggestions: GET /llama/autocomplete?type=binary&query=xxx */
  router.get("/llama/autocomplete", async (req: Request, res: Response) => {
    try {
      const type = req.query.type as string;
      const query = (req.query.query as string) ?? "";

      const validTypes = ["binary", "model", "mmproj", "apikey", "host", "device", "path"];
      if (!type || !validTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type. Must be one of: ${validTypes.join(", ")}` });
      }

      const acas = container.get<LlamaAutocompleteService>(LLAMA_AUTOCOMPLETE_SERVICE);

      // Pass all existing configs for cross-service suggestions
      const scc = container.get<ServiceConfigController>(SERVICE_CONFIG_CONTROLLER);
      const allConfigs = scc.listConfigs();

      // Wire GPU service for device suggestions (lazy, avoids circular dep)
      try {
        const gpuService = container.get<GpuService>(GPU_SERVICE);
        acas.setGpuService(gpuService);
      } catch {
        // GPU service not available — device suggestions will be empty
      }

      const suggestions = await acas.getSuggestions(type as AutocompleteType, query, allConfigs);
      res.json(suggestions);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Get recent journal lines for a service: GET /journal/:name?lines=100 */
  router.get("/journal/:name", async (req: Request, res: Response) => {
    try {
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const lines = parseInt(req.query.lines as string, 10) || 100;

      const sm = container.get<ServiceManager>(SERVICE_MANAGER);
      const result = await sm.getJournal(name, lines);

      if ("error" in result) {
        return res.status(404).json(result);
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
