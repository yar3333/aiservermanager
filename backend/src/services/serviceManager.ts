import { multiInject } from "inversify";
import { ServiceAction, ServiceStatus } from "../models/ServiceStatus";
import { ServiceController } from "./serviceController";
import { ConfigManager } from "./configManager";
import { ManagedServicesManager } from "./managedServicesManager";
import { buildExecStart } from "../models/ServiceConfig";

/** Service metadata — defaults for each known service. */
interface ServiceDef {
  name: string;
}

/** Resolve all service names: user-managed + deep-managed configs. */
function resolveServiceDefs(configManager: ConfigManager, managedServices: ManagedServicesManager): ServiceDef[] {
  const seen = new Set<string>();
  const defs: ServiceDef[] = [];

  // User-managed services from persistent selection
  for (const name of managedServices.list()) {
    if (!seen.has(name)) {
      seen.add(name);
      defs.push({ name });
    }
  }

  // Deep-managed services from configs
  for (const cfg of configManager.list()) {
    if (!seen.has(cfg.name)) {
      seen.add(cfg.name);
      defs.push({ name: cfg.name });
    }
  }

  return defs;
}

export class ServiceManager {
  private readonly configManager = new ConfigManager();
  private readonly managedServices = new ManagedServicesManager();
  /** Errors from initial deep-managed install attempts — served on every getStatusList without re-checking. */
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
    return resolveServiceDefs(this.configManager, this.managedServices);
  }

  /**
   * Called once at server startup. Attempts to install every deep-managed service
   * that has a config but is not yet registered in the OS. Installation errors
   * are cached so that getStatusList can return them without re-checking.
   */
  async bootstrap(): Promise<void> {
    const controller = await this.getActiveController();
    if (!controller) return;

    // Check which deep-managed services are not installed yet
    const deepManagedNames = this.configManager.list().map((c) => c.name);
    const statuses = await Promise.all(deepManagedNames.map((name) => controller.getStatus(name)));

    // Attempt install in parallel for all missing ones
    await Promise.all(
      statuses.map(async (status) => {
        if (status.installed) return;

        const cfg = this.configManager.get(status.name);
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
        // Skip getStatus if we already know install failed — return cached error directly
        const cached = this.installErrors.get(def.name);
        if (cached) {
          return {
            ...def,
            running: false,
            enabled: false,
            installed: false,
            error: cached,
          };
        }

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
   * Install a deep-managed service from its config, then enable it.
   * Only works for services that have a config but are not yet installed.
   */
  async installAndEnable(name: string): Promise<ServiceStatus> {
    const cfg = this.configManager.get(name);
    if (!cfg) {
      throw new Error(`Config "${name}" not found — cannot install without config`);
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
