import express from "express";
import cors from "cors";
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

app.listen(PORT, HOST, () => {
  console.log(`aiservermanager backend listening on http://${HOST}:${PORT}`);
});
