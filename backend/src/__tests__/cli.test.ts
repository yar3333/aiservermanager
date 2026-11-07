import { ServiceController } from "../services/serviceController";
import { ServiceStatus } from "../models/ServiceStatus";
import { parseArgs, run } from "../cli";

jest.mock("../helpers/ExecTools");

const ENTRY = "C:\\app\\backend\\dist\\index.js";
const HOME = "C:\\Users\\yan";

function status(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return { name: "aiservermanager", running: false, enabled: false, installed: true, ...overrides };
}

function fakeController(overrides: Partial<ServiceController> = {}): ServiceController {
  return {
    isAvailable: jest.fn().mockResolvedValue(true),
    getStatus: jest.fn().mockResolvedValue(status()),
    perform: jest.fn().mockResolvedValue(status({ running: true, pid: 4711 })),
    install: jest.fn().mockResolvedValue(status()),
    installAndEnable: jest.fn().mockResolvedValue(status({ enabled: true })),
    uninstall: jest.fn().mockResolvedValue({ ok: true }),
    listAvailable: jest.fn().mockResolvedValue([]),
    getJournal: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/** Defaults that keep a test away from sudo checks, the port probe and npm's home. */
function overrides(controller: ServiceController, extra: Record<string, unknown> = {}) {
  return {
    controllers: [controller],
    isPrivileged: async () => true,
    portOwner: async () => undefined,
    configHome: HOME,
    entryScript: ENTRY,
    ...extra,
  };
}

function capture() {
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  return {
    out: () => log.mock.calls.map((call) => call.join(" ")).join("\n"),
    err: () => error.mock.calls.map((call) => call.join(" ")).join("\n"),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseArgs", () => {
  it("reads the install options", () => {
    expect(parseArgs(["install", "--port", "4399", "--host", "0.0.0.0", "--config-home", "/home/yan"])).toEqual({
      command: "install",
      port: 4399,
      host: "0.0.0.0",
      configHome: "/home/yan",
    });
  });

  it("rejects a port that cannot be listened on", () => {
    expect(parseArgs(["install", "--port", "0"])).toEqual({
      error: '--port expects a number between 1 and 65535, got "0"',
    });
  });

  it("rejects an unknown option and an unknown command", () => {
    expect(parseArgs(["install", "--user", "yan"])).toMatchObject({ error: expect.stringContaining("--user") });
    expect(parseArgs(["instal"])).toEqual({ error: "Unknown command: instal" });
  });

  it("treats help flags as help", () => {
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
  });
});

describe("run install", () => {
  it("registers the manager itself through the platform controller", async () => {
    const controller = fakeController();
    const io = capture();

    const code = await run(["install", "--port", "4399"], overrides(controller));

    expect(code).toBe(0);
    expect(controller.installAndEnable).toHaveBeenCalledWith(
      "aiservermanager",
      expect.stringContaining(ENTRY),
      expect.objectContaining({
        environment: expect.objectContaining({ PORT: "4399", HOST: "127.0.0.1", HOME }),
        restart: "always",
        executable: process.execPath,
        args: [ENTRY],
      }),
    );
    expect(controller.perform).toHaveBeenCalledWith("aiservermanager", "start");
    expect(io.out()).toContain("http://127.0.0.1:4399");
  });

  it("refuses without privileges and touches nothing", async () => {
    const controller = fakeController();
    const io = capture();

    const code = await run(["install"], overrides(controller, { isPrivileged: async () => false }));

    expect(code).toBe(1);
    expect(controller.installAndEnable).not.toHaveBeenCalled();
    expect(io.err()).toContain("needs");
    expect(io.err()).toContain(String(process.pid));
  });

  it("does not register a service that would lose the port race", async () => {
    const controller = fakeController();
    const io = capture();

    const code = await run(
      ["install", "--port", "4243"],
      overrides(controller, { portOwner: async () => "LISTEN 0 511 127.0.0.1:4243 users:((\"node\",pid=99))" }),
    );

    expect(code).toBe(1);
    expect(controller.installAndEnable).not.toHaveBeenCalled();
    expect(io.err()).toContain("already held");
  });

  it("reports an install error from the controller", async () => {
    const controller = fakeController({
      installAndEnable: jest.fn().mockResolvedValue(status({ installed: false, error: "Access is denied" })),
    });
    const io = capture();

    const code = await run(["install"], overrides(controller));

    expect(code).toBe(1);
    expect(io.err()).toContain("Access is denied");
  });
});

describe("run status / control / uninstall", () => {
  it("prints the state of an installed service", async () => {
    const controller = fakeController({
      getStatus: jest.fn().mockResolvedValue(status({ running: true, enabled: true, pid: 77 })),
    });
    const io = capture();

    expect(await run(["status"], overrides(controller))).toBe(0);
    expect(io.out()).toBe("aiservermanager: running (pid 77), autostart on");
  });

  it("says so when nothing was installed", async () => {
    const controller = fakeController({ getStatus: jest.fn().mockResolvedValue(status({ installed: false })) });
    const io = capture();

    expect(await run(["status"], overrides(controller))).toBe(0);
    expect(io.out()).toContain("not installed");
  });

  it("restarts with a stop before the start, because sc.exe has no restart", async () => {
    const controller = fakeController();

    expect(await run(["restart"], overrides(controller))).toBe(0);
    expect(controller.perform).toHaveBeenNthCalledWith(1, "aiservermanager", "stop");
    expect(controller.perform).toHaveBeenNthCalledWith(2, "aiservermanager", "start");
  });

  it("removes the registration and keeps the configs", async () => {
    const controller = fakeController();
    const io = capture();

    expect(await run(["uninstall"], overrides(controller))).toBe(0);
    expect(controller.uninstall).toHaveBeenCalledWith("aiservermanager");
    expect(io.out()).toContain("configs were left in place");
  });
});

describe("run usage", () => {
  it("prints help without touching the OS", async () => {
    const io = capture();
    expect(await run(["help"])).toBe(0);
    expect(io.out()).toContain("aiservermanager install");
  });

  it("exits with 2 for an unknown command", async () => {
    const io = capture();
    expect(await run(["instal"])).toBe(2);
    expect(io.err()).toContain("Unknown command: instal");
  });
});
