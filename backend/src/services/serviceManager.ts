import { multiInject } from "inversify";
import { ServiceAction, ServiceStatus } from "../models/ServiceStatus";
import { ServiceController } from "./serviceController";

/** Service metadata — defaults for each known service. */
interface ServiceDef {
  name: string;
}

const KNOWN_SERVICES: ServiceDef[] = [{ name: "llama" }, { name: "comfyui" }];

export class ServiceManager {
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

  async getStatusList(): Promise<ServiceStatus[]> {
    const controller = await this.getActiveController();

    if (!controller) {
      return KNOWN_SERVICES.map((def) => ({
        ...def,
        running: false,
        enabled: false,
        error: "No service controller available on this platform",
      }));
    }

    const results = await Promise.all(
      KNOWN_SERVICES.map(async (def) => {
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
    const def = KNOWN_SERVICES.find((s) => s.name === name);
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
