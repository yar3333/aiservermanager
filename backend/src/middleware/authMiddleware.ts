import { Request, Response, NextFunction } from "express";
import { Container } from "inversify";
import { AUTH_SERVICE } from "../di/types";
import { AuthService } from "../services/authService";

/**
 * Express middleware that validates JWT from Authorization: Bearer <token> header.
 * Skips /health endpoint.
 */
export function authMiddleware(container: Container) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // Allow health check without auth
    if (req.path === "/health") return next();

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return _res.status(401).json({ error: "Authorization header required" });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return _res.status(401).json({ error: "Invalid authorization format. Use: Bearer <token>" });
    }

    const authService = container.get<AuthService>(AUTH_SERVICE);
    const payload = authService.verifyToken(parts[1]);

    if (!payload) {
      return _res.status(401).json({ error: "Invalid or expired token" });
    }

    // Attach user info to request
    (req as any).user = payload;
    next();
  };
}
