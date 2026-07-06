import request from "supertest";
import express from "express";
import cors from "cors";

// Minimal app without GPU routes to test health endpoint and static setup
describe("App", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(cors());
    app.use(express.json());

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", uptime: process.uptime() });
    });
  });

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(typeof res.body.uptime).toBe("number");
    });
  });

  describe("CORS", () => {
    it("includes CORS headers", async () => {
      const res = await request(app).get("/health");
      expect(res.header["access-control-allow-origin"]).toBeDefined();
    });
  });
});
