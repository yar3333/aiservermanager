import { multiInject } from "inversify";
import { ServiceAction, ServiceStatus } from "../models/ServiceStatus";
import { ServiceController } from "./serviceController";
import { ConfigManager } from "./configManager";
import { ServiceConfig, computeServiceName } from "../models/ServiceConfig";

/** Service metadata — defaults for each known service. */
interface ServiceDef {
  name: string;
}

const LLAMA_PREFIX = "aism-llama-";
const BUILT_IN_SERVICES: ServiceDef[] = [{ name: "llama" }, { name: "comfyui" }];

/** Resolve all service names: built-in + user-created llama configs. */
function resolveServiceDefs(configManager: ConfigManager): ServiceDef[] {
  const seen = new Set<string>();
  const defs: ServiceDef[] = [];

  // Built-in services first
  for (const def of BUILT_IN_SERVICES) {
    if (!seen.has(def.name)) {
      seen.add(def.name);
      defs.push(def);
    }
  }

  // User-created llama services from configs
  for (const cfg of configManager.list()) {
    const name = computeServiceName(cfg.suffix);
    if (!seen.has(name)) {
      seen.add(name);
      defs.push({ name });
    }
  }

  return defs;
}

/** Build the full ExecStart command from a service config. */
function buildExecStart(cfg: ServiceConfig): string {
  const args = Object.entries(cfg.flags)
    .map(([key, value]) => {
      if (value.includes(" ")) {
        return `${key}='${value}'`;
      }
      return `${key}=${value}`;
    })
    .join(" ");

  return args ? `${cfg.command} ${args}` : cfg.command;
}

export class ServiceManager {
  private readonly configManager = new ConfigManager();
  /** Errors from initial aism-llama install attempts — served on every getStatusList without re-checking. */
  private readonly installErrors = new Map<string, string>();

  constructor(
    @multiInject("SERVICE_CONTROLLER")
    private readonly controllers: ServiceController[],
  ) {}

  private async getActiveController(): Promise<ServiceController | null> {
    for (const c of this.controllers) {
      if (await c.isAvailable()) return c;
    }
    return null;
  }

  private getServiceDefs(): ServiceDef[] {
    return resolveServiceDefs(this.configManager);
  }

  /**
   * Called once at server startup. Attempts to install every aism-llama service
   * that has a config but is not yet registered in the OS. Installation errors
   * are cached so that getStatusList can return them without re-checking.
   */
  async bootstrap(): Promise<void> {
    const controller = await this.getActiveController();
    if (!controller) return;

    const defs = this.getServiceDefs();

    // Check which aism-llama services are not installed yet
    const statuses = await Promise.all(
      defs.filter((d) => d.name.startsWith(LLAMA_PREFIX)).map((d) => controller.getStatus(d.name)),
    );

    // Attempt install in parallel for all missing ones
    await Promise.all(
      statuses.map(async (status) => {
        if (status.installed) return;

        const suffix = status.name.slice(LLAMA_PREFIX.length);
        const cfg = this.configManager.get(suffix);
        if (!cfg) return;

        const execStart = buildExecStart(cfg);
        const result = await controller.installAndEnable(status.name, execStart);

        // If install failed, cache the error
        if (result.error) {
          this.installErrors.set(status.name, result.error);
        }
      }),
    );
  }

  async getStatusList(): Promise<ServiceStatus[]> {
    const controller = await this.getActiveController();
    const defs = this.getServiceDefs();

    if (!controller) {
      return defs.map((def) => ({
        ...def,
        running: false,
        enabled: false,
        installed: false,
        error: "No service controller available on this platform",
      }));
    }

    const results = await Promise.all(
      defs.map(async (def) => {
        try {
          const status = await controller.getStatus(def.name);
          return { ...def, ...status };
        } catch {
          return {
            ...def,
            running: false,
            enabled: false,
            installed: false,
            error: `Failed to query service "${def.name}"`,
          };
        }
      }),
    );

    // Override "not found" with cached install error if available
    for (const status of results) {
      const cached = this.installErrors.get(status.name);
      if (cached && !status.installed) {
        status.error = cached;
      }
    }

    return results;
  }

  async performAction(name: string, action: ServiceAction): Promise<ServiceStatus> {
    const defs = this.getServiceDefs();
    const def = defs.find((s) => s.name === name);
    if (!def) {
      throw new Error(`Unknown service: ${name}`);
    }

    const controller = await this.getActiveController();
    if (!controller) {
      throw new Error("No service controller available on this platform");
    }

    const status = await controller.perform(name, action);
    return { ...def, ...status };
  }

  /**
   * Install an aism-llama service from its config, then enable it.
   * Only works for user-created llama services that have a config but are not yet installed.
   */
  async installAndEnable(name: string): Promise<ServiceStatus> {
    // Only aism-llama services can be installed this way
    if (!name.startsWith(LLAMA_PREFIX)) {
      throw new Error(`installAndEnable is only for aism-llama- services, got: ${name}`);
    }

    const suffix = name.slice(LLAMA_PREFIX.length);
    const cfg = this.configManager.get(suffix);
    if (!cfg) {
      throw new Error(`Config "${suffix}" not found — cannot install without config`);
    }

    const controller = await this.getActiveController();
    if (!controller) {
      throw new Error("No service controller available on this platform");
    }

    const execStart = buildExecStart(cfg);
    const status = await controller.installAndEnable(name, execStart);
    return status;
  }
}
