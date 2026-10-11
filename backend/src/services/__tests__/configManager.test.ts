import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ServiceConfig, serializeConfig } from "../../models/ServiceConfig";

// ConfigManager resolves CONFIG_DIR / ARCHIVE_DIR from process.env.HOME at module
// load time, so re-require it under a temp HOME to test against an isolated dir.
describe("ConfigManager (archive)", () => {
  let tmpHome: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ConfigManager: any;
  let servicesDir: string;
  let archiveDir: string;

  beforeAll(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "cfgmgr-"));
    servicesDir = path.join(tmpHome, ".config", "aiservermanager", "services");
    archiveDir = path.join(tmpHome, ".config", "aiservermanager", "services-archive");
    process.env.HOME = tmpHome;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ConfigManager = require("../configManager").ConfigManager;
    });
  });

  afterAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Start each test with a clean, empty services + archive dir.
    fs.rmSync(servicesDir, { recursive: true, force: true });
    fs.rmSync(archiveDir, { recursive: true, force: true });
  });

  function writeConfig(name: string, dir: string, cfg: Partial<ServiceConfig> = {}): void {
    fs.mkdirSync(dir, { recursive: true });
    const full: ServiceConfig = {
      name,
      command: cfg.command ?? "/usr/bin/echo",
      flags: cfg.flags ?? [],
      environment: cfg.environment,
    };
    fs.writeFileSync(path.join(dir, `${name}.conf`), serializeConfig(full), "utf-8");
  }

  it("lists no archived configs when the archive is empty", () => {
    const cm = new ConfigManager();
    expect(cm.listArchived()).toEqual([]);
  });

  it("archive() moves a config from services to the archive", () => {
    writeConfig("my-svc", servicesDir);
    const cm = new ConfigManager();

    expect(cm.archive("my-svc")).toBe(true);

    expect(fs.existsSync(path.join(servicesDir, "my-svc.conf"))).toBe(false);
    expect(fs.existsSync(path.join(archiveDir, "my-svc.conf"))).toBe(true);
  });

  it("archive() returns false when the config does not exist", () => {
    const cm = new ConfigManager();
    expect(cm.archive("nope")).toBe(false);
  });

  it("restore() moves a config back from the archive to services", () => {
    writeConfig("my-svc", archiveDir);
    const cm = new ConfigManager();

    expect(cm.restore("my-svc")).toBe(true);

    expect(fs.existsSync(path.join(archiveDir, "my-svc.conf"))).toBe(false);
    expect(fs.existsSync(path.join(servicesDir, "my-svc.conf"))).toBe(true);
  });

  it("restore() returns false when the archived config does not exist", () => {
    const cm = new ConfigManager();
    expect(cm.restore("nope")).toBe(false);
  });

  it("listArchived() returns archived configs sorted by name", () => {
    writeConfig("zzz", archiveDir);
    writeConfig("aaa", archiveDir, { command: "/usr/bin/ls", flags: ["-l"] });
    const cm = new ConfigManager();

    const archived = cm.listArchived();
    expect(archived.map((c: ServiceConfig) => c.name)).toEqual(["aaa", "zzz"]);
    expect(archived[0].command).toBe("/usr/bin/ls");
    expect(archived[0].flags).toEqual(["-l"]);
  });

  it("archive + restore round-trips a config's contents", () => {
    writeConfig("roundtrip", servicesDir, {
      command: "/usr/bin/foo",
      flags: ["--bar", "1"],
      environment: { FOO: "bar" },
    });
    const cm = new ConfigManager();

    cm.archive("roundtrip");
    const inArchive = cm.listArchived().find((c: ServiceConfig) => c.name === "roundtrip");
    expect(inArchive).toBeDefined();
    expect(inArchive.command).toBe("/usr/bin/foo");
    expect(inArchive.flags).toEqual(["--bar", "1"]);
    expect(inArchive.environment).toEqual({ FOO: "bar" });

    cm.restore("roundtrip");
    const inServices = cm.get("roundtrip");
    expect(inServices).toBeDefined();
    expect(inServices.command).toBe("/usr/bin/foo");
    expect(inServices.flags).toEqual(["--bar", "1"]);
    expect(inServices.environment).toEqual({ FOO: "bar" });
  });
});
