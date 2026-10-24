import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { LmStudioService } from "../lmStudioService";

describe("LmStudioService", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "lmstudio-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const service = (): LmStudioService => new LmStudioService(root);

  it("returns [] when the models root does not exist", async () => {
    const svc = new LmStudioService(path.join(root, "missing"));
    await expect(svc.listModels()).resolves.toEqual([]);
  });

  it("lists publisher/model directories with their size", async () => {
    const modelDir = path.join(root, "lmstudio-community", "Test-Model-GGUF");
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, "model-q4.gguf"), Buffer.alloc(2048));
    fs.writeFileSync(path.join(modelDir, "model-q8.gguf"), Buffer.alloc(1024));

    const models = await service().listModels();
    expect(models).toHaveLength(1);
    expect(models[0]).toEqual({ name: "lmstudio-community/Test-Model-GGUF", dir: modelDir, size: 3072 });
  });

  it("counts nested files", async () => {
    const modelDir = path.join(root, "pub", "nested");
    fs.mkdirSync(path.join(modelDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(modelDir, "a.bin"), Buffer.alloc(100));
    fs.writeFileSync(path.join(modelDir, "sub", "b.bin"), Buffer.alloc(50));

    const models = await service().listModels();
    expect(models).toHaveLength(1);
    expect(models[0].size).toBe(150);
  });

  it("ignores stray files in the root and in publisher dirs (only dirs are models)", async () => {
    fs.writeFileSync(path.join(root, "not-a-dir"), "x");
    fs.mkdirSync(path.join(root, "pub"), { recursive: true });
    fs.writeFileSync(path.join(root, "pub", "loose-file.gguf"), "x");

    await expect(service().listModels()).resolves.toEqual([]);
  });

  it("sorts models by name", async () => {
    for (const [pub, name] of [["b-pub", "z-model"], ["a-pub", "m-model"]] as const) {
      fs.mkdirSync(path.join(root, pub, name), { recursive: true });
    }
    const names = (await service().listModels()).map((m) => m.name);
    expect(names).toEqual(["a-pub/m-model", "b-pub/z-model"]);
  });

  describe("deleteModel", () => {
    it("deletes the model directory and the empty publisher dir", async () => {
      const modelDir = path.join(root, "pub", "gone");
      fs.mkdirSync(modelDir, { recursive: true });
      fs.writeFileSync(path.join(modelDir, "m.gguf"), "x");

      await service().deleteModel("pub/gone");

      expect(fs.existsSync(modelDir)).toBe(false);
      expect(fs.existsSync(path.join(root, "pub"))).toBe(false);
    });

    it("keeps the publisher dir when other models remain", async () => {
      fs.mkdirSync(path.join(root, "pub", "a"), { recursive: true });
      fs.mkdirSync(path.join(root, "pub", "b"), { recursive: true });

      await service().deleteModel("pub/a");

      expect(fs.existsSync(path.join(root, "pub", "a"))).toBe(false);
      expect(fs.existsSync(path.join(root, "pub", "b"))).toBe(true);
    });

    it("throws Model not found for a missing model", async () => {
      await expect(service().deleteModel("pub/missing")).rejects.toThrow("Model not found");
    });

    it("rejects invalid names", async () => {
      await expect(service().deleteModel("no-slash")).rejects.toThrow("Invalid model name");
      await expect(service().deleteModel("pub/..")).rejects.toThrow("Invalid model name");
    });
  });
});
