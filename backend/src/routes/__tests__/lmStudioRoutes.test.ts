import request from "supertest";
import express from "express";
import { Container } from "inversify";
import lmStudioRoutes from "../lmStudioRoutes";
import { LM_STUDIO_SERVICE } from "../../di/types";
import { LmStudioService } from "../../services/lmStudioService";

describe("LM Studio routes", () => {
  let app: express.Express;
  let mockSvc: LmStudioService;

  beforeEach(() => {
    mockSvc = {
      listModels: jest.fn(),
      deleteModel: jest.fn(),
      deleteModelFile: jest.fn(),
    } as unknown as LmStudioService;

    const container = new Container();
    container.bind<LmStudioService>(LM_STUDIO_SERVICE).toConstantValue(mockSvc);

    app = express();
    app.use("/api/lmstudio", lmStudioRoutes(container));
  });

  describe("GET /api/lmstudio/models", () => {
    it("returns the model list", async () => {
      const list = [{ name: "pub/model", dir: "/root/pub/model", size: 10 }];
      (mockSvc as any).listModels.mockResolvedValue(list);
      const res = await request(app).get("/api/lmstudio/models");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(list);
    });

    it("returns 500 on error", async () => {
      (mockSvc as any).listModels.mockRejectedValue(new Error("boom"));
      const res = await request(app).get("/api/lmstudio/models");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("boom");
    });
  });

  describe("DELETE /api/lmstudio/models/:org/:name", () => {
    it("deletes a model", async () => {
      (mockSvc as any).deleteModel.mockResolvedValue(undefined);
      const res = await request(app).delete("/api/lmstudio/models/pub/model");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect((mockSvc as any).deleteModel).toHaveBeenCalledWith("pub/model");
    });

    it("returns 404 when the model does not exist", async () => {
      (mockSvc as any).deleteModel.mockRejectedValue(new Error("Model not found: pub/x"));
      const res = await request(app).delete("/api/lmstudio/models/pub/x");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Model not found: pub/x");
    });

    it("returns 400 on invalid name", async () => {
      (mockSvc as any).deleteModel.mockRejectedValue(new Error("Invalid model name: org/../etc"));
      const res = await request(app).delete("/api/lmstudio/models/org/..%2Fetc");
      expect(res.status).toBe(400);
    });

    it("returns 500 on other errors", async () => {
      (mockSvc as any).deleteModel.mockRejectedValue(new Error("boom"));
      const res = await request(app).delete("/api/lmstudio/models/pub/x");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("boom");
    });
  });

  describe("DELETE /api/lmstudio/models/:org/:name/files/*splat", () => {
    it("deletes a single quantization file", async () => {
      (mockSvc as any).deleteModelFile.mockResolvedValue(undefined);
      const res = await request(app).delete("/api/lmstudio/models/pub/model/files/model-q4.gguf");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect((mockSvc as any).deleteModelFile).toHaveBeenCalledWith("pub/model", "model-q4.gguf");
    });

    it("passes through nested file paths", async () => {
      (mockSvc as any).deleteModelFile.mockResolvedValue(undefined);
      const res = await request(app).delete("/api/lmstudio/models/pub/model/files/sub/shard-1.gguf");
      expect(res.status).toBe(200);
      expect((mockSvc as any).deleteModelFile).toHaveBeenCalledWith("pub/model", "sub/shard-1.gguf");
    });

    it("returns 404 when the file does not exist", async () => {
      (mockSvc as any).deleteModelFile.mockRejectedValue(new Error("File not found: pub/m/a.gguf"));
      const res = await request(app).delete("/api/lmstudio/models/pub/m/files/a.gguf");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("File not found: pub/m/a.gguf");
    });

    it("returns 400 on invalid file path", async () => {
      (mockSvc as any).deleteModelFile.mockRejectedValue(new Error("Invalid file path"));
      const res = await request(app).delete("/api/lmstudio/models/pub/m/files/a%2F..%2F..%2Fescape");
      expect(res.status).toBe(400);
    });
  });
});
