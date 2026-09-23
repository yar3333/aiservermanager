import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GpuLabelManager } from "../gpuLabelManager";

describe("GpuLabelManager", () => {
  let tmpDir: string;
  let configPath: string;
  let manager: GpuLabelManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpu-label-"));
    configPath = path.join(tmpDir, "gpu-label.conf");
    manager = new GpuLabelManager(configPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty map when file does not exist", () => {
    expect(manager.getAll()).toEqual({});
  });

  it("upserts an entry and reads it back", () => {
    manager.set("1:00.0", "cuda0");
    expect(manager.getAll()).toEqual({ "1:00.0": "cuda0" });
  });

  it("keeps one line per GPU and preserves other entries on update", () => {
    manager.set("1:00.0", "cuda0");
    manager.set("2:00.0", "rocm0");

    manager.set("1:00.0", "cuda0, control");

    expect(manager.getAll()).toEqual({ "1:00.0": "cuda0, control", "2:00.0": "rocm0" });
    const lines = fs.readFileSync(configPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("removes the entry when passed an empty value", () => {
    manager.set("1:00.0", "cuda0");
    manager.set("1:00.0", "   ");

    expect(manager.getAll()).toEqual({});
  });

  it("trims keys and values, and supports values containing '='", () => {
    fs.writeFileSync(configPath, " 01:00.0 = main, backup=2 \n", "utf-8");

    expect(manager.getAll()).toEqual({ "01:00.0": "main, backup=2" });
  });

  it("ignores empty lines and comments", () => {
    fs.writeFileSync(configPath, "# user notes\n\n1:00.0=cuda0\n", "utf-8");

    expect(manager.getAll()).toEqual({ "1:00.0": "cuda0" });
  });

  it("reads entries written manually", () => {
    fs.writeFileSync(configPath, "1:00.0=cuda0\n2:00.0=rocm0\n", "utf-8");

    expect(manager.getAll()).toEqual({ "1:00.0": "cuda0", "2:00.0": "rocm0" });
  });

  it("creates the config directory on write", () => {
    const nested = path.join(tmpDir, "nested", "dir", "gpu-label.conf");
    const nestedManager = new GpuLabelManager(nested);

    nestedManager.set("1:00.0", "cuda0");

    expect(fs.existsSync(nested)).toBe(true);
    expect(nestedManager.getAll()).toEqual({ "1:00.0": "cuda0" });
  });
});