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

  return router;
}
