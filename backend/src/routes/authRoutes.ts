import { Router } from "express";
import { Container } from "inversify";
import { AUTH_SERVICE } from "../di/types";
import { AuthService } from "../services/authService";

/** Extract real client IP, respecting reverse proxy headers. */
function getClientIp(req: import("express").Request): string {
  const forwarded = req.headers["x-forwarded-for"] as string | undefined;
  if (forwarded) {
    // X-Forwarded-For: "client, proxy1, proxy2" — first is the original client
    return forwarded.split(",")[0].trim();
  }
  return req.ip ?? "127.0.0.1";
}

export default function authRoutes(container: Container): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    try {
      const { password } = req.body as { password?: string };

      if (!password) {
        return res.status(400).json({ error: "Password is required" });
      }

      const authService = container.get<AuthService>(AUTH_SERVICE);
      const ip = getClientIp(req);

      // Check rate limit BEFORE touching PAM — timing-safe
      const limited = authService.checkRateLimit(ip);
      if (limited) {
        return res.status(429).json({
          error: "Too many attempts. Try again later.",
          retryAfter: limited.retryAfter,
        });
      }

      const token = await authService.login(ip, password);

      if (!token) {
        return res.status(401).json({ error: "Invalid password" });
      }

      res.json({ token });
    } catch (error) {
      console.error("[Auth] login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
