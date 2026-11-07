import "reflect-metadata";
import * as path from "path";
import { createContainer } from "./di/container";
import { SERVICE_CONTROLLER } from "./di/types";
import { ServiceController } from "./services/serviceController";
import { ServerIdentity } from "./helpers/ServerIdentity";
import { ExecTools } from "./helpers/ExecTools";
import { SELF_SERVICE_NAME, buildSelfInstallPlan, defaultConfigHome } from "./services/selfInstall";

const USAGE = `aiservermanager — GPU server monitoring and AI service manager

  aiservermanager                      run the dashboard in the foreground
  aiservermanager install              register it as an OS service and start it
  aiservermanager status               show the service state
  aiservermanager start|stop|restart   control the service
  aiservermanager uninstall            remove the OS registration (configs are kept)

Install options:
  --port <n>          port the service listens on (default ${ServerIdentity.port})
  --host <iface>      interface to bind (default ${ServerIdentity.host}; 0.0.0.0 for the LAN)
  --config-home <dir> home holding .config/aiservermanager (default the invoking user's home)

Installing needs an elevated shell: sudo on Linux, an elevated PowerShell on Windows.`;

/** Parsed command line, or a message explaining why parsing failed. */
export type ParsedArgs =
  | { command: string; port?: number; host?: string; configHome?: string }
  | { error: string };

const COMMANDS = new Set(["install", "uninstall", "status", "start", "stop", "restart"]);
const VALUE_FLAGS = new Set(["--port", "--host", "--config-home"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") return { command: "help" };
  if (!COMMANDS.has(command)) return { error: `Unknown command: ${command}` };

  const parsed: { port?: number; host?: string; configHome?: string } = {};
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!VALUE_FLAGS.has(flag) || value === undefined) {
      return { error: `Unknown or incomplete option for "${command}": ${flag ?? ""}`.trimEnd() };
    }
    if (flag === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { error: `--port expects a number between 1 and 65535, got "${value}"` };
      }
      parsed.port = port;
    } else if (flag === "--host") {
      parsed.host = value;
    } else {
      parsed.configHome = value;
    }
  }

  return { command, ...parsed };
}

/**
 * Test seam: everything is the real thing unless a test replaces it. Kept as an
 * explicit argument because mocking whole modules would drag the DI container
 * (auth, GPU probes, the optional PAM addon) into a unit test.
 */
export interface CliOverrides {
  controllers?: ServiceController[];
  isPrivileged?: () => Promise<boolean>;
  portOwner?: (port: number) => Promise<string | undefined>;
  configHome?: string;
  entryScript?: string;
  execPath?: string;
}

async function pickController(controllers: ServiceController[]): Promise<ServiceController | undefined> {
  for (const controller of controllers) {
    if (await controller.isAvailable()) return controller;
  }
  return undefined;
}

function containerControllers(): ServiceController[] {
  return createContainer().getAll<ServiceController>(SERVICE_CONTROLLER);
}

/** Who already listens on the port, or undefined when it is free. */
async function findPortOwner(port: number): Promise<string | undefined> {
  const probe =
    process.platform === "win32"
      ? `netstat -ano | findstr /C:":${port} " | findstr /I LISTENING`
      : `ss -ltnp | grep ":${port} "`;
  const { stdout } = await ExecTools.safeExec(probe);
  const line = stdout.split("\n").find((entry) => entry.trim());
  return line ? line.trim() : undefined;
}

async function privilegeError(action: string, overrides: CliOverrides): Promise<string | undefined> {
  const privileged = await (overrides.isPrivileged ?? ((): Promise<boolean> => ServerIdentity.isPrivileged()))();
  if (privileged) return undefined;

  const how = process.platform === "win32" ? "an elevated (Run as administrator) PowerShell" : "sudo";
  return (
    `"${action}" needs ${how}: this process (pid ${process.pid}) cannot change OS services. ` +
    `Run the same command again elevated.`
  );
}

async function install(argv: string[], overrides: CliOverrides): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    console.error(`${args.error}\n\n${USAGE}`);
    return 2;
  }

  const blocked = await privilegeError("install", overrides);
  if (blocked) {
    console.error(blocked);
    return 1;
  }

  const controller = await pickController(overrides.controllers ?? containerControllers());
  if (!controller) {
    console.error("No service controller on this platform — cannot register a service.");
    return 1;
  }

  const port = args.port ?? ServerIdentity.port;
  const host = args.host ?? ServerIdentity.host;
  const configHome = args.configHome ?? overrides.configHome ?? (await defaultConfigHome());

  const owner = await (overrides.portOwner ?? findPortOwner)(port);
  if (owner) {
    console.error(
      `Port ${port} is already held by another process — the service would start and immediately exit.\n` +
        `  ${owner}\n` +
        `Stop it first, or install with --port <free port>.`,
    );
    return 1;
  }

  const plan = buildSelfInstallPlan({
    host,
    port,
    configHome,
    entryScript: overrides.entryScript,
    nodePath: overrides.execPath,
  });
  const configDir = path.join(configHome, ".config", "aiservermanager");
  console.log(`Installing "${SELF_SERVICE_NAME}" as an OS service…`);
  console.log(`  program   ${plan.options.executable ?? plan.execStart}`);
  console.log(`  arguments ${(plan.options.args ?? []).join(" ") || "(none)"}`);
  console.log(`  listens   http://${host}:${port}`);
  console.log(`  configs   ${configDir}`);

  const installed = await controller.installAndEnable(plan.name, plan.execStart, plan.options);
  if (installed.error) {
    console.error(`Install failed: ${installed.error}`);
    return 1;
  }

  const started = await controller.perform(plan.name, "start");
  if (started.error) {
    console.error(`Installed and enabled, but it did not start: ${started.error}`);
    return 1;
  }

  console.log(`Started (pid ${started.pid ?? "?"}) — open http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
  console.log(
    process.platform === "win32"
      ? `Logs: WinSW keeps them under ${path.join(configDir, "winsw", SELF_SERVICE_NAME)}`
      : `Logs: journalctl -u ${SELF_SERVICE_NAME}`,
  );
  console.log("Remove with: aiservermanager uninstall");
  return 0;
}

async function control(action: "start" | "stop" | "restart", overrides: CliOverrides): Promise<number> {
  const blocked = await privilegeError(action, overrides);
  if (blocked) {
    console.error(blocked);
    return 1;
  }

  const controller = await pickController(overrides.controllers ?? containerControllers());
  if (!controller) {
    console.error("No service controller on this platform.");
    return 1;
  }

  // "restart" is not an OS-service action this app models — systemctl knows it,
  // sc.exe does not, so both platforms get an explicit stop followed by start.
  if (action === "restart") {
    const stopped = await controller.perform(SELF_SERVICE_NAME, "stop");
    if (stopped.error && stopped.running) {
      console.error(`restart failed while stopping: ${stopped.error}`);
      return 1;
    }
  }

  const result = await controller.perform(SELF_SERVICE_NAME, action === "stop" ? "stop" : "start");
  if (result.error) {
    console.error(`${action} failed: ${result.error}`);
    return 1;
  }
  console.log(`${SELF_SERVICE_NAME}: ${result.running ? `running (pid ${result.pid ?? "?"})` : "stopped"}`);
  return 0;
}

async function status(overrides: CliOverrides): Promise<number> {
  const controller = await pickController(overrides.controllers ?? containerControllers());
  if (!controller) {
    console.error("No service controller on this platform.");
    return 1;
  }

  const state = await controller.getStatus(SELF_SERVICE_NAME);
  if (!state.installed) {
    console.log(`${SELF_SERVICE_NAME}: not installed as an OS service (run "aiservermanager install")`);
    return 0;
  }
  const running = state.running ? `running (pid ${state.pid ?? "?"})` : "stopped";
  console.log(`${SELF_SERVICE_NAME}: ${running}, autostart ${state.enabled ? "on" : "off"}`);
  return 0;
}

async function uninstall(overrides: CliOverrides): Promise<number> {
  const blocked = await privilegeError("uninstall", overrides);
  if (blocked) {
    console.error(blocked);
    return 1;
  }

  const controller = await pickController(overrides.controllers ?? containerControllers());
  if (!controller) {
    console.error("No service controller on this platform.");
    return 1;
  }

  const removed = await controller.uninstall(SELF_SERVICE_NAME);
  if (!removed.ok) {
    console.error(`Uninstall failed: ${removed.error}`);
    return 1;
  }
  console.log(`${SELF_SERVICE_NAME} removed from the OS. Service configs were left in place.`);
  return 0;
}

/** Entry point of the published `aiservermanager` bin; returns the process exit code. */
export async function run(argv: string[], overrides: CliOverrides = {}): Promise<number> {
  const [command] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return 0;
    case "install":
      return install(argv, overrides);
    case "uninstall":
      return uninstall(overrides);
    case "status":
      return status(overrides);
    case "start":
    case "stop":
    case "restart":
      return control(command, overrides);
    default:
      console.error(`${USAGE}\n\nUnknown command: ${command}`);
      return 2;
  }
}

/** Runs the CLI and exits with its code — used by the published bin script. */
export function main(argv: string[] = process.argv.slice(2)): void {
  run(argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

// `node backend/dist/cli.js status` and `ts-node src/cli.ts …` would otherwise
// load the module and silently do nothing.
if (require.main === module) main();
