import express from "express";
import cors from "cors";
import path from "path";
import gpuRoutes from "./routes/gpuRoutes";

const app = express();
const PORT = parseInt(process.env.PORT ?? "4242", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/gpus", gpuRoutes);

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

app.listen(PORT, HOST, () => {
  console.log(`aiservermanager backend listening on http://${HOST}:${PORT}`);
});
