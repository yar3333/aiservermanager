import { multiInject } from "inversify";
import { ServiceAction, ServiceStatus } from "../models/ServiceStatus";
import { ServiceController } from "./serviceController";
import { ConfigManager } from "./configManager";
import { computeServiceName } from "../models/ServiceConfig";

/** Service metadata — defaults for each known service. */
interface ServiceDef {
  name: string;
}

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

export class ServiceManager {
  private readonly configManager = new ConfigManager();

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

  async getStatusList(): Promise<ServiceStatus[]> {
    const controller = await this.getActiveController();
    const defs = this.getServiceDefs();

    if (!controller) {
      return defs.map((def) => ({
        ...def,
        running: false,
        enabled: false,
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
}
