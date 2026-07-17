import { Router } from "express";
import { Container } from "inversify";
import { AUTH_SERVICE } from "../di/types";
import { AuthService } from "../services/authService";

export default function authRoutes(container: Container): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    try {
      const { password } = req.body as { password?: string };

      if (!password) {
        return res.status(400).json({ error: "Password is required" });
      }

      const authService = container.get<AuthService>(AUTH_SERVICE);
      const token = await authService.login(password);

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
