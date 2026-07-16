import { multiInject } from "inversify";
import { ServiceController } from "./serviceController";
import { ManagedServicesManager } from "./managedServicesManager";
import { ConfigManager } from "./configManager";

/**
 * API layer for discovering available system services and managing the user's selection.
 * Excludes deep-managed services (those with a config) from the available list.
 */
export class ManagedServicesController {
  private readonly manager = new ManagedServicesManager();
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

  /** List all installed services on the system (excludes deep-managed). */
  async listAvailable(): Promise<string[]> {
    const controller = await this.getActiveController();
    if (!controller) return [];
    return controller.listAvailable();
  }

  /** List the user-selected managed service names. */
  listManaged(): string[] {
    return this.manager.list();
  }

  /** Add a service name to the managed list. */
  addManaged(name: string): { ok: boolean; error?: string } {
    // Reject deep-managed — those are managed via configs
    if (this.configManager.get(name) !== null) {
      return { ok: false, error: `"${name}" is a deep-managed service — manage it via the service config dialog` };
    }
    const added = this.manager.add(name);
    if (!added) return { ok: false, error: `"${name}" is already in the managed list` };
    return { ok: true };
  }

  /** Remove a service name from the managed list. */
  removeManaged(name: string): { ok: boolean; error?: string } {
    const removed = this.manager.remove(name);
    if (!removed) return { ok: false, error: `"${name}" is not in the managed list` };
    return { ok: true };
  }
}
