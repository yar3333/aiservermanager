import { Router } from "express";
import { Container } from "inversify";
import { ExecTools } from "../helpers/ExecTools";

export default function systemRoutes(_container: Container) {
  const router = Router();

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
