import request from "supertest";
import express from "express";
import { Container } from "inversify";
import hfRoutes from "../hfRoutes";
import { HF_DOWNLOADS_SERVICE } from "../../di/types";
import { HfDownloadsService } from "../../services/hfDownloadsService";

describe("HF routes", () => {
  let app: express.Express;
  let container: Container;
  let mockSvc: HfDownloadsService;

  beforeEach(() => {
    mockSvc = {
      isInstalled: jest.fn(),
      listDownloads: jest.fn(),
      sendAction: jest.fn(),
    } as unknown as HfDownloadsService;

    container = new Container();
    container.bind<HfDownloadsService>(HF_DOWNLOADS_SERVICE).toConstantValue(mockSvc);

    app = express();
    app.use(express.json());
    app.use("/api/hf", hfRoutes(container));
  });

  describe("GET /api/hf/status", () => {
    it("returns installed status", async () => {
      (mockSvc as any).isInstalled.mockResolvedValue({ installed: true, version: "1.15.0" });
      const res = await request(app).get("/api/hf/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ installed: true, version: "1.15.0" });
    });
  });

  describe("GET /api/hf/downloads", () => {
    it("returns the download list", async () => {
      const list = [{ repoId: "org/model", doneBytes: 10 }];
      (mockSvc as any).listDownloads.mockResolvedValue(list);
      const res = await request(app).get("/api/hf/downloads");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(list);
    });

    it("returns 500 on error", async () => {
      (mockSvc as any).listDownloads.mockRejectedValue(new Error("boom"));
      const res = await request(app).get("/api/hf/downloads");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("boom");
    });
  });

  describe("POST /api/hf/downloads/action", () => {
    it("returns 400 when fields are missing", async () => {
      const res = await request(app).post("/api/hf/downloads/action").send({ action: "pause" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("required");
    });

    it("returns 400 for an invalid action", async () => {
      const res = await request(app)
        .post("/api/hf/downloads/action")
        .send({ action: "kill", repoId: "org/model", dest: "/tmp" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid action");
    });

    it("forwards valid action to the service", async () => {
      (mockSvc as any).sendAction.mockResolvedValue(undefined);
      const res = await request(app)
        .post("/api/hf/downloads/action")
        .send({ action: "pause", repoId: "org/model", dest: "/tmp/x" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect((mockSvc as any).sendAction).toHaveBeenCalledWith("pause", "org/model", "/tmp/x");
    });

    it("returns 404 when the download is not found", async () => {
      (mockSvc as any).sendAction.mockRejectedValue(new Error("No active download found for org/model"));
      const res = await request(app)
        .post("/api/hf/downloads/action")
        .send({ action: "cancel", repoId: "org/model", dest: "/tmp/x" });
      expect(res.status).toBe(404);
    });

    it("returns 500 on other errors", async () => {
      (mockSvc as any).sendAction.mockRejectedValue(new Error("permission denied"));
      const res = await request(app)
        .post("/api/hf/downloads/action")
        .send({ action: "cancel", repoId: "org/model", dest: "/tmp/x" });
      expect(res.status).toBe(500);
    });
  });
});
