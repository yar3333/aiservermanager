import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExecTools } from "../helpers/ExecTools";
import { InstallOptions, USER_GROUP_REGEX } from "../models/ServiceConfig";

/** Name the manager registers itself under in the OS service database. */
export const SELF_SERVICE_NAME = "aiservermanager";

/**
 * Directories a service does not inherit from a login shell but the GPU probes
 * need: nvidia-smi lives in /usr/bin, rocm-smi in /opt/rocm/bin, lspci in /usr/bin.
 */
const LINUX_SERVICE_PATH_DIRS = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
  "/opt/rocm/bin",
];

/** What to hand to ServiceController.installAndEnable() to host the manager itself. */
export interface SelfInstallPlan {
  name: string;
  execStart: string;
  options: InstallOptions;
}

export interface SelfInstallInput {
  /** Interface the service will listen on. */
  host: string;
  port: number;
  /** Injected for tests; defaults to the running host. */
  platform?: NodeJS.Platform;
  nodePath?: string;
  entryScript?: string;
  /** User home whose `.config/aiservermanager` the service must see. */
  configHome?: string;
  /** Shell PATH to keep on top of the service search path (Linux). */
  currentPath?: string;
}

/**
 * The script the service runs: the compiled backend one level up from this
 * module (dist/services → dist/index.js, also the packaged layout), or the build
 * output when the sources run through ts-node (src/services → backend/dist).
 */
export function resolveEntryScript(fromDir: string = __dirname): string | undefined {
  const candidates = [
    path.resolve(fromDir, "..", "index.js"),
    path.resolve(fromDir, "..", "..", "dist", "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

export function linuxServicePath(currentPath?: string): string {
  const parts = (currentPath ?? "").split(":").filter(Boolean);
  for (const dir of LINUX_SERVICE_PATH_DIRS) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(":");
}

/** systemd splits ExecStart on spaces, so a path containing one needs quoting. */
function quoteForSystemd(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Home whose `.config/aiservermanager` the service must read.
 *
 * Installing on Linux goes through sudo, and under sudo `os.homedir()` answers
 * the target account (`/root`), not the user whose configs are already on disk
 * — so follow `SUDO_USER` when it is set.
 */
export async function defaultConfigHome(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const sudoUser = platform === "win32" ? undefined : env.SUDO_USER?.trim();
  if (!sudoUser || !USER_GROUP_REGEX.test(sudoUser)) return os.homedir();

  const { stdout } = await ExecTools.safeExec(`getent passwd ${sudoUser}`);
  const home = stdout.trim().split(":")[5];
  return home || os.homedir();
}

/**
 * Plan for running ai server manager itself as an OS service.
 *
 * The service runs as root / LocalSystem because controlling other services is
 * the whole point, and a service gets no login environment — so `HOME` is
 * written into it explicitly. Without that the manager would read
 * `/root/.config/aiservermanager` (or the system profile on Windows) and every
 * custom service config the user created would look like it had vanished.
 */
export function buildSelfInstallPlan(input: SelfInstallInput): SelfInstallPlan {
  const platform = input.platform ?? process.platform;
  const nodePath = input.nodePath ?? process.execPath;
  const entryScript = input.entryScript ?? resolveEntryScript();
  if (!entryScript) {
    throw new Error("No backend entry script found — run npm run build before installing the service.");
  }

  const configHome = input.configHome ?? os.homedir();
  const isWindows = platform === "win32";
  // The target platform decides how its paths are spelled, not the host running
  // the installer: POSIX dirname of "C:\app\dist\index.js" is ".".
  const targetPath = isWindows ? path.win32 : path.posix;
  const workingDirectory = targetPath.dirname(entryScript);

  const environment: Record<string, string> = {
    PORT: String(input.port),
    HOST: input.host,
    HOME: configHome,
  };
  if (isWindows) {
    environment.USERPROFILE = configHome;
  } else {
    environment.PATH = linuxServicePath(input.currentPath ?? process.env.PATH);
  }

  return {
    name: SELF_SERVICE_NAME,
    execStart: `${quoteForSystemd(nodePath)} ${quoteForSystemd(entryScript)}`,
    options: {
      environment,
      restart: "always",
      // WinSW takes the program and its arguments apart, so it needs them unquoted.
      executable: isWindows ? nodePath : undefined,
      args: isWindows ? [entryScript] : undefined,
      workingDirectory: isWindows ? workingDirectory : quoteForSystemd(workingDirectory),
    },
  };
}
