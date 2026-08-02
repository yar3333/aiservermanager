import "reflect-metadata";
import express from "express";
import cors from "cors";
import path from "path";
import { createContainer } from "./di/container";
import gpuRoutes from "./routes/gpuRoutes";
import serviceRoutes from "./routes/serviceRoutes";
import systemRoutes from "./routes/systemRoutes";
import authRoutes from "./routes/authRoutes";
import { authMiddleware } from "./middleware/authMiddleware";
import { SERVICE_MANAGER } from "./di/types";
import { ServiceManager } from "./services/serviceManager";

const container = createContainer();
const app = express();
const PORT = parseInt(process.env.PORT ?? "4243");
const HOST = process.env.HOST ?? "127.0.0.1";

app.use(cors());
app.use(express.json());

// ── Public: frontend (must be before auth middleware) ──

const publicPath = path.join(__dirname, "../public/browser");
app.use(express.static(publicPath));

// SPA fallback — serve index.html for all non-API routes
app.use((_req, res, next) => {
  // Let API routes pass through; only SPA fallback for non-/api paths
  if (_req.path.startsWith("/api")) return next();
  res.sendFile(path.join(publicPath, "index.html"));
});

// ── Public API routes ──

app.use("/api/auth", authRoutes(container));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ── Protected API routes — require JWT ──

app.use(authMiddleware(container));
app.use("/api/gpus", gpuRoutes(container));
app.use("/api/services", serviceRoutes(container));
app.use("/api/system", systemRoutes(container));

// Bootstrap: auto-install custom services, cache install errors
const sm = container.get<ServiceManager>(SERVICE_MANAGER);
sm.bootstrap().catch((err) => {
  console.error("[ServiceManager] bootstrap failed:", err);
});

app.listen(PORT, HOST, () => {
  console.log(`aiservermanager backend listening on http://${HOST}:${PORT}`);
});
