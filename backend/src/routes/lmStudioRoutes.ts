import { Request, Response, Router } from "express";
import { Container } from "inversify";
import { LM_STUDIO_SERVICE } from "../di/types";
import { LmStudioService } from "../services/lmStudioService";

export default function lmStudioRoutes(container: Container) {
  const router = Router();

  /** Models downloaded via LM Studio (~/.lmstudio/models), with sizes. */
  router.get("/models", async (_req: Request, res: Response) => {
    try {
      const svc = container.get<LmStudioService>(LM_STUDIO_SERVICE);
      res.json(await svc.listModels());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Delete a model directory from ~/.lmstudio/models. */
  router.delete("/models/:org/:name", async (req: Request, res: Response) => {
    try {
      const org = Array.isArray(req.params.org) ? req.params.org[0] : req.params.org;
      const name = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const svc = container.get<LmStudioService>(LM_STUDIO_SERVICE);
      await svc.deleteModel(`${org}/${name}`);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.startsWith("Model not found")
        ? 404
        : message.startsWith("Invalid")
          ? 400
          : 500;
      res.status(status).json({ error: message });
    }
  });

  return router;
}
