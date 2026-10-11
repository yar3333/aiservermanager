import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ServiceConfig, buildExecStart, serializeConfig } from "../../models/ServiceConfig";
import { ServiceController } from "../serviceController";
import { ServiceStatus } from "../../models/ServiceStatus";

// ServiceConfigController builds its own ConfigManager, which resolves its dirs
// from process.env.HOME at module load time. Re-require under a temp HOME.
describe("ServiceConfigController (archive)", () => {
  let tmpHome: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ServiceConfigController: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ConfigManager: any;
  let servicesDir: string;
  let archiveDir: string;

  const stoppedStatus: ServiceStatus = { name: "x", running: false, enabled: false, installed: false };

  function makeController(overrides: Partial<ServiceController> = {}): ServiceController {
    return {
      isAvailable: jest.fn().mockResolvedValue(true),
      getStatus: jest.fn().mockResolvedValue({ ...stoppedStatus }),
      perform: jest.fn().mockResolvedValue({ ...stoppedStatus, installed: true }),
      install: jest.fn().mockResolvedValue({ ...stoppedStatus, installed: true }),
      installAndEnable: jest.fn().mockResolvedValue({ ...stoppedStatus, installed: true, enabled: true }),
      uninstall: jest.fn().mockResolvedValue({ ok: true }),
      listAvailable: jest.fn().mockResolvedValue([]),
      getJournal: jest.fn().mockResolvedValue([]),
      ...overrides,
    };
  }

  function writeConfig(name: string, dir: string, cfg: Partial<ServiceConfig> = {}): ServiceConfig {
    fs.mkdirSync(dir, { recursive: true });
    const full: ServiceConfig = {
      name,
      command: cfg.command ?? "/usr/bin/echo",
      flags: cfg.flags ?? [],
      environment: cfg.environment,
    };
    fs.writeFileSync(path.join(dir, `${name}.conf`), serializeConfig(full), "utf-8");
    return full;
  }

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "scc-"));
    servicesDir = path.join(tmpHome, ".config", "aiservermanager", "services");
    archiveDir = path.join(tmpHome, ".config", "aiservermanager", "services-archive");
    process.env.HOME = tmpHome;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ServiceConfigController = require("../serviceConfigController").ServiceConfigController;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ConfigManager = require("../configManager").ConfigManager;
    });
  });

  afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(servicesDir, { recursive: true, force: true });
    fs.rmSync(archiveDir, { recursive: true, force: true });
  });

  describe("archiveService", () => {
    it("uninstalls the OS service then moves the config to the archive", async () => {
      writeConfig("my-svc", servicesDir);
      const controller = makeController();
      const scc = new ServiceConfigController([controller]);

      const result = await scc.archiveService("my-svc");

      expect(result.ok).toBe(true);
      expect(controller.uninstall).toHaveBeenCalledWith("my-svc");
      expect(fs.existsSync(path.join(servicesDir, "my-svc.conf"))).toBe(false);
      expect(fs.existsSync(path.join(archiveDir, "my-svc.conf"))).toBe(true);
    });

    it("returns an error and does not uninstall when the config is missing", async () => {
      const controller = makeController();
      const scc = new ServiceConfigController([controller]);

      const result = await scc.archiveService("nope");

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/);
      expect(controller.uninstall).not.toHaveBeenCalled();
    });

    it("still archives the config when uninstall reports a warning", async () => {
      writeConfig("my-svc", servicesDir);
      const controller = makeController({
        uninstall: jest.fn().mockResolvedValue({ ok: false, error: "boom" }),
      });
      const scc = new ServiceConfigController([controller]);

      const result = await scc.archiveService("my-svc");

      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(archiveDir, "my-svc.conf"))).toBe(true);
    });
  });

  describe("restoreService", () => {
    it("moves the config back and reinstalls the OS service", async () => {
      const cfg = writeConfig("my-svc", archiveDir, { command: "/usr/bin/foo", flags: ["--x", "1"] });
      const controller = makeController();
      const scc = new ServiceConfigController([controller]);

      const result = await scc.restoreService("my-svc");

      expect(result.ok).toBe(true);
      expect(fs.existsSync(path.join(archiveDir, "my-svc.conf"))).toBe(false);
      expect(fs.existsSync(path.join(servicesDir, "my-svc.conf"))).toBe(true);
      expect(controller.install).toHaveBeenCalledWith("my-svc", buildExecStart(cfg), cfg.environment);
    });

    it("returns an error and does not install when the archived config is missing", async () => {
      const controller = makeController();
      const scc = new ServiceConfigController([controller]);

      const result = await scc.restoreService("nope");

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/);
      expect(controller.install).not.toHaveBeenCalled();
    });

    it("propagates an install error", async () => {
      writeConfig("my-svc", archiveDir);
      const controller = makeController({
        install: jest.fn().mockResolvedValue({ ...stoppedStatus, error: "install failed" }),
      });
      const scc = new ServiceConfigController([controller]);

      const result = await scc.restoreService("my-svc");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("install failed");
      // Config was moved back — user can retry from the UI.
      expect(fs.existsSync(path.join(servicesDir, "my-svc.conf"))).toBe(true);
    });
  });

  describe("listArchivedConfigs", () => {
    it("delegates to the config manager's archived list", () => {
      writeConfig("aaa", archiveDir);
      writeConfig("bbb", archiveDir);
      const scc = new ServiceConfigController([makeController()]);

      expect(scc.listArchivedConfigs().map((c: ServiceConfig) => c.name)).toEqual(["aaa", "bbb"]);
    });

    it("returns empty when the archive is empty", () => {
      const scc = new ServiceConfigController([makeController()]);
      expect(scc.listArchivedConfigs()).toEqual([]);
    });
  });
});
