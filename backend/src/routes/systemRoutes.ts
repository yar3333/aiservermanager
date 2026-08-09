import { Router } from "express";
import { Container } from "inversify";
import { ExecTools } from "../helpers/ExecTools";
import { SYSTEM_INFO_PROVIDER } from "../di/types";
import { SystemInfoProvider } from "../services/systemInfoProvider";

export default function systemRoutes(container: Container) {
  const router = Router();

  /** Get system information via platform-aware provider. */
  router.get("/info", async (_req, res) => {
    try {
      const providers = container.getAll<SystemInfoProvider>(SYSTEM_INFO_PROVIDER);
      let provider: SystemInfoProvider | null = null;
      for (const p of providers) {
        if (await p.isAvailable()) {
          provider = p;
          break;
        }
      }
      if (!provider) {
        res.status(501).json({ error: "System info is not available on this platform" });
        return;
      }
      res.json(await provider.getSystemInfo());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Reboot the server. */
  router.post("/reboot", async (_req, res) => {
    try {
      const cmd = process.platform === "win32" ? "shutdown /r /t 0" : "sudo reboot";
      const result = await ExecTools.safeExec(cmd);
      if (result.stderr) {
        res.status(500).json({ error: result.stderr });
      } else {
        res.json({ status: "reboot initiated" });
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  /** Shutdown the server. */
  router.post("/shutdown", async (_req, res) => {
    try {
      const cmd = process.platform === "win32" ? "shutdown /s /t 0" : "sudo poweroff";
      const result = await ExecTools.safeExec(cmd);
      if (result.stderr) {
        res.status(500).json({ error: result.stderr });
      } else {
        res.json({ status: "shutdown initiated" });
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
    }
  });

  return router;
}
