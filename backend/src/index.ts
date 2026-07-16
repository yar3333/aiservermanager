import "reflect-metadata";
import express from "express";
import cors from "cors";
import path from "path";
import { createContainer } from "./di/container";
import gpuRoutes from "./routes/gpuRoutes";
import serviceRoutes from "./routes/serviceRoutes";
import { SERVICE_MANAGER } from "./di/types";
import { ServiceManager } from "./services/serviceManager";

const container = createContainer();
const app = express();
const PORT = parseInt(process.env.PORT ?? "4242", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/gpus", gpuRoutes(container));
app.use("/api/services", serviceRoutes(container));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Serve compiled frontend (production)
const publicPath = path.join(__dirname, "../public/browser");
app.use(express.static(publicPath));

// SPA fallback — serve index.html for all non-API routes
app.use((_req, res, next) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// Bootstrap: auto-install custom services, cache install errors
const sm = container.get<ServiceManager>(SERVICE_MANAGER);
sm.bootstrap().catch((err) => {
  console.error("[ServiceManager] bootstrap failed:", err);
});

app.listen(PORT, HOST, () => {
  console.log(`aiservermanager backend listening on http://${HOST}:${PORT}`);
});
