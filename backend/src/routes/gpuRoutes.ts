import { Router } from "express";
import { getGpuList } from "../services/gpuService";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const gpus = await getGpuList();
    res.json(gpus);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

export default router;
