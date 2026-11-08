import * as fs from "fs";
import * as os from "os";
import { ExecTools } from "../../helpers/ExecTools";
import {
  buildSelfInstallPlan,
  defaultAuthUser,
  defaultConfigHome,
  linuxServicePath,
  resolveEntryScript,
  SELF_SERVICE_NAME,
} from "../selfInstall";

jest.mock("../../helpers/ExecTools");
jest.mock("fs");

const mockedExec = ExecTools as unknown as { safeExec: jest.Mock };
const mockedFs = fs as unknown as { existsSync: jest.Mock };

afterEach(() => {
  jest.restoreAllMocks();
});

describe("defaultAuthUser", () => {
  it("names the local account behind an elevated Windows shell", () => {
    // An elevated PowerShell keeps the invoking user; the dashboard has to check
    // that person's password, because the service it becomes runs as LocalSystem.
    expect(defaultAuthUser("win32", { USERNAME: "yan", USERDOMAIN: "WORK", COMPUTERNAME: "WORK" })).toBe("yan");
  });

  it("keeps the domain when the account does not come from this machine", () => {
    expect(defaultAuthUser("win32", { USERNAME: "yan", USERDOMAIN: "CORP", COMPUTERNAME: "WORK" })).toBe(
      "CORP\\yan",
    );
  });

  it("follows sudo to the human on Linux, not to root", () => {
    expect(defaultAuthUser("linux", { SUDO_USER: "yan", USER: "root" })).toBe("yan");
    expect(defaultAuthUser("linux", { LOGNAME: "yan", USER: "root" })).toBe("yan");
    expect(defaultAuthUser("linux", { USER: "yan" })).toBe("yan");
  });

  it("says nothing when the environment names no human at all", () => {
    expect(defaultAuthUser("win32", {})).toBeUndefined();
    expect(defaultAuthUser("linux", {})).toBeUndefined();
  });
});

describe("buildSelfInstallPlan", () => {
  it("runs node itself on Windows and pins the user profile", () => {
    const plan = buildSelfInstallPlan({
      platform: "win32",
      host: "127.0.0.1",
      port: 4399,
      nodePath: "C:\\Program Files\\nodejs\\node.exe",
      entryScript: "C:\\app\\backend\\dist\\index.js",
      configHome: "C:\\Users\\yan",
    });

    expect(plan.name).toBe(SELF_SERVICE_NAME);
    expect(plan.options.executable).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(plan.options.args).toEqual(["C:\\app\\backend\\dist\\index.js"]);
    expect(plan.options.workingDirectory).toBe("C:\\app\\backend\\dist");
    expect(plan.options.restart).toBe("always");
    expect(plan.options.environment).toEqual({
      PORT: "4399",
      HOST: "127.0.0.1",
      HOME: "C:\\Users\\yan",
      USERPROFILE: "C:\\Users\\yan",
    });
  });

  it("pins the account whose password opens the dashboard", () => {
    // LocalSystem has no password to type, so without this the service would
    // check a login that does not exist and call every real password wrong.
    const plan = buildSelfInstallPlan({
      platform: "win32",
      host: "127.0.0.1",
      port: 4243,
      nodePath: "C:\\nodejs\\node.exe",
      entryScript: "C:\\app\\backend\\dist\\index.js",
      configHome: "C:\\Users\\yan",
      authUser: "CORP\\yan",
    });

    expect(plan.options.environment?.AUTH_USER).toBe("CORP\\yan");
  });

  it("keeps the home visible to a root systemd service and widens PATH for the GPU probes", () => {
    const plan = buildSelfInstallPlan({
      platform: "linux",
      host: "0.0.0.0",
      port: 4243,
      nodePath: "/usr/bin/node",
      entryScript: "/opt/aiservermanager/backend/dist/index.js",
      configHome: "/home/yan",
      currentPath: "/home/yan/.local/bin:/usr/bin",
    });

    expect(plan.execStart).toBe("/usr/bin/node /opt/aiservermanager/backend/dist/index.js");
    expect(plan.options.executable).toBeUndefined();
    expect(plan.options.environment).toMatchObject({ PORT: "4243", HOST: "0.0.0.0", HOME: "/home/yan" });
    expect(plan.options.environment?.HOME).toBe("/home/yan");
    expect(plan.options.environment?.PATH).toBe(
      "/home/yan/.local/bin:/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/bin:/opt/rocm/bin",
    );
    expect(plan.options.workingDirectory).toBe("/opt/aiservermanager/backend/dist");
  });

  it("quotes a path that contains a space so systemd keeps it in one piece", () => {
    const plan = buildSelfInstallPlan({
      platform: "linux",
      host: "127.0.0.1",
      port: 4243,
      nodePath: "/opt/node 24/bin/node",
      entryScript: "/opt/ai server/backend/dist/index.js",
      configHome: "/home/yan",
    });

    expect(plan.execStart).toBe('"/opt/node 24/bin/node" "/opt/ai server/backend/dist/index.js"');
  });

  it("fails loudly instead of registering a service it cannot start", () => {
    expect(() =>
      buildSelfInstallPlan({
        platform: "linux",
        host: "127.0.0.1",
        port: 4243,
        entryScript: "",
        configHome: "/home/yan",
      }),
    ).toThrow(/npm run build/);
  });
});

describe("resolveEntryScript", () => {
  it("prefers the compiled entry beside the module and falls back to the build output", () => {
    mockedFs.existsSync.mockImplementation((candidate: string) => /[\\/]dist[\\/]index\.js$/.test(candidate));

    expect(resolveEntryScript("/repo/backend/src/services")).toMatch(/[\\/]dist[\\/]index\.js$/);
    // The packaged layout keeps cli.js in the same dist directory as index.js.
    expect(resolveEntryScript("/pkg/backend/dist/services")).toMatch(/backend[\\/]dist[\\/]index\.js$/);
  });

  it("returns nothing when the backend was never built", () => {
    mockedFs.existsSync.mockReturnValue(false);

    expect(resolveEntryScript("/repo/backend/src/services")).toBeUndefined();
  });
});

describe("linuxServicePath", () => {
  it("keeps the installing shell's entries and appends what a service lacks", () => {
    expect(linuxServicePath("/usr/bin:/opt/rocm/bin")).toBe(
      "/usr/bin:/opt/rocm/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/bin",
    );
  });

  it("survives an unset PATH", () => {
    expect(linuxServicePath(undefined)).toContain("/usr/bin");
  });
});

describe("defaultConfigHome", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the user behind sudo instead of root's home", async () => {
    mockedExec.safeExec.mockResolvedValue({ stdout: "yan:x:1000:1000::/home/yan:/bin/bash\n", stderr: "" });

    await expect(defaultConfigHome("linux", { SUDO_USER: "yan" })).resolves.toBe("/home/yan");
    expect(mockedExec.safeExec).toHaveBeenCalledWith("getent passwd yan");
  });

  it("asks nobody when the command was not run through sudo", async () => {
    await expect(defaultConfigHome("linux", {})).resolves.toBe(os.homedir());
    expect(mockedExec.safeExec).not.toHaveBeenCalled();
  });

  it("ignores a SUDO_USER that is not a plain account name", async () => {
    await expect(defaultConfigHome("linux", { SUDO_USER: "yan; rm -rf /" })).resolves.toBe(os.homedir());
    expect(mockedExec.safeExec).not.toHaveBeenCalled();
  });

  it("uses the profile on Windows, where sudo does not exist", async () => {
    await expect(defaultConfigHome("win32", { SUDO_USER: "yan" })).resolves.toBe(os.homedir());
    expect(mockedExec.safeExec).not.toHaveBeenCalled();
  });
});
