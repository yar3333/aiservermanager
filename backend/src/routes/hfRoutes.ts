import { Request, Response, Router } from "express";
import { Container } from "inversify";
import { HF_DOWNLOADS_SERVICE } from "../di/types";
import { HfDownloadsService } from "../services/hfDownloadsService";

export default function hfRoutes(container: Container) {
  const router = Router();

  /** Whether the `hf` CLI is installed. */
  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      res.json(await svc.isInstalled());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Active `hf download` process groups with progress, speed and ETA. */
  router.get("/downloads", async (_req: Request, res: Response) => {
    try {
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      res.json(await svc.listDownloads());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Control a download: { action: "pause" | "resume" | "cancel", repoId, dest } */
  router.post("/downloads/action", async (req: Request, res: Response) => {
    try {
      const { action, repoId, dest } = req.body ?? {};
      if (!action || !repoId || !dest) {
        return res.status(400).json({ error: "'action', 'repoId' and 'dest' are required" });
      }
      if (!["pause", "resume", "cancel"].includes(action)) {
        return res.status(400).json({ error: `Invalid action: ${action}` });
      }
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      await svc.sendAction(action, repoId, dest);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.startsWith("No active download") ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  /** Models already present in the local Hugging Face cache (with sizes). */
  router.get("/models", async (_req: Request, res: Response) => {
    try {
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      res.json(await svc.listLocalModels());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Delete a model's cache directory from the local Hugging Face cache. */
  router.delete("/models/:org/:name", async (req: Request, res: Response) => {
    try {
      const org = Array.isArray(req.params.org) ? req.params.org[0] : req.params.org;
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      await svc.deleteLocalModel(`${org}/${name}`);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.startsWith("Model not found")
        ? 404
        : message.startsWith("Invalid model name")
          ? 400
          : 500;
      res.status(status).json({ error: message });
    }
  });

  /** Blob files in the shared <hub>/blobs referenced by no model (and older than 24h). */
  router.get("/models/orphans", async (_req: Request, res: Response) => {
    try {
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      res.json(await svc.listOrphanBlobs());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Delete all orphan blobs. */
  router.post("/models/orphans/cleanup", async (_req: Request, res: Response) => {
    try {
      const svc = container.get<HfDownloadsService>(HF_DOWNLOADS_SERVICE);
      res.json(await svc.cleanupOrphanBlobs());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
