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
    expect(models[0]).toEqual({
      name: "lmstudio-community/Test-Model-GGUF",
      dir: modelDir,
      size: 3072,
      files: [
        { name: "model-q4.gguf", size: 2048 },
        { name: "model-q8.gguf", size: 1024 },
      ],
    });
  });

  it("lists only gguf files in the files array", async () => {
    const modelDir = path.join(root, "pub", "mixed");
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, "model.Q4_K_M.gguf"), Buffer.alloc(2048));
    fs.writeFileSync(path.join(modelDir, "README.md"), "x");
    fs.writeFileSync(path.join(modelDir, "tokenizer.json"), "x");

    const models = await service().listModels();
    expect(models[0].files).toEqual([{ name: "model.Q4_K_M.gguf", size: 2048 }]);
  });

  it("counts nested gguf files", async () => {
    const modelDir = path.join(root, "pub", "nested");
    fs.mkdirSync(path.join(modelDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(modelDir, "a.gguf"), Buffer.alloc(100));
    fs.writeFileSync(path.join(modelDir, "sub", "b.gguf"), Buffer.alloc(50));
    fs.writeFileSync(path.join(modelDir, "README.md"), "x");

    const models = await service().listModels();
    expect(models).toHaveLength(1);
    expect(models[0].size).toBe(150);
    expect(models[0].files).toEqual([
      { name: "a.gguf", size: 100 },
      { name: path.join("sub", "b.gguf"), size: 50 },
    ]);
  });

  it("groups sharded weights into one entry", async () => {
    const modelDir = path.join(root, "pub", "sharded");
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, "Model-BF16-00001-of-00002.gguf"), Buffer.alloc(3000));
    fs.writeFileSync(path.join(modelDir, "Model-BF16-00002-of-00002.gguf"), Buffer.alloc(1000));
    fs.writeFileSync(path.join(modelDir, "Model-Q4.gguf"), Buffer.alloc(500));

    const models = await service().listModels();
    expect(models[0].files).toEqual([
      { name: "Model-BF16.gguf", size: 4000, shards: ["Model-BF16-00001-of-00002.gguf", "Model-BF16-00002-of-00002.gguf"] },
      { name: "Model-Q4.gguf", size: 500 },
    ]);
    expect(models[0].size).toBe(4500);
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

  describe("deleteModelFile", () => {
    it("deletes a single gguf file and keeps the model dir", async () => {
      const modelDir = path.join(root, "pub", "m");
      fs.mkdirSync(modelDir, { recursive: true });
      fs.writeFileSync(path.join(modelDir, "a.gguf"), Buffer.alloc(2048));
      fs.writeFileSync(path.join(modelDir, "b.gguf"), Buffer.alloc(1024));

      await service().deleteModelFile("pub/m", "a.gguf");

      expect(fs.existsSync(path.join(modelDir, "a.gguf"))).toBe(false);
      expect(fs.existsSync(path.join(modelDir, "b.gguf"))).toBe(true);
      expect(fs.existsSync(modelDir)).toBe(true);
    });

    it("removes the model dir when the last file is deleted", async () => {
      fs.mkdirSync(path.join(root, "pub", "m"), { recursive: true });
      fs.writeFileSync(path.join(root, "pub", "m", "a.gguf"), "x");

      await service().deleteModelFile("pub/m", "a.gguf");

      expect(fs.existsSync(path.join(root, "pub", "m"))).toBe(false);
      expect(fs.existsSync(path.join(root, "pub"))).toBe(false);
    });

    it("rejects traversal outside the models root", async () => {
      fs.mkdirSync(path.join(root, "pub", "m"), { recursive: true });
      await expect(service().deleteModelFile("pub/m", "../../escape.gguf")).rejects.toThrow("Invalid file path");
    });

    it("throws File not found for a missing file", async () => {
      fs.mkdirSync(path.join(root, "pub", "m"), { recursive: true });
      await expect(service().deleteModelFile("pub/m", "nope.gguf")).rejects.toThrow("File not found");
    });
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
