import { multiInject } from "inversify";
import { ServiceConfig, buildExecStart } from "../models/ServiceConfig";
import { ConfigManager } from "./configManager";
import { ServiceController } from "./serviceController";

const NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

/**
 * Orchestrates config CRUD + OS service installation via platform-aware ServiceController.
 * Singleton — shares one ConfigManager and injects ServiceControllers.
 */
export class ServiceConfigController {
  private readonly configManager = new ConfigManager();

  constructor(
    @multiInject("SERVICE_CONTROLLER")
    private readonly controllers: ServiceController[],
  ) {}

  /** List all saved service configs. */
  listConfigs(): ServiceConfig[] {
    return this.configManager.list();
  }

  /** Get a single config by name. */
  getConfig(name: string): ServiceConfig | null {
    return this.configManager.get(name);
  }

  private async getActiveController(): Promise<ServiceController | null> {
    for (const c of this.controllers) {
      if (await c.isAvailable()) return c;
    }
    return null;
  }

  /**
   * Create or update a service config and its OS service.
   * No name change — that logic lives on the frontend (delete → create).
   * Preserves the enabled state when updating an existing service.
   * @returns { ok, config?, error? }
   */
  async createOrUpdate(cfg: ServiceConfig): Promise<{ ok: boolean; config?: ServiceConfig; error?: string }> {
    // Validate name
    if (!NAME_REGEX.test(cfg.name)) {
      return {
        ok: false,
        error: "Name must start with a letter and contain only letters, digits, hyphens, underscores (max 128 chars)",
      };
    }

    // Validate command
    if (!cfg.command.trim()) {
      return { ok: false, error: "Command path is required" };
    }

    // Save config file
    this.configManager.save(cfg);

    // Install/update OS service (without changing enabled state)
    const controller = await this.getActiveController();
    if (controller) {
      const execStart = buildExecStart(cfg);

      // Check if service was already installed — preserve its enabled state
      const priorStatus = await controller.getStatus(cfg.name);
      const wasInstalled = priorStatus.installed;
      const wasEnabled = wasInstalled && priorStatus.enabled;

      const result = await controller.install(cfg.name, execStart);
      if (result.error) {
        // Config was saved but service install failed — keep config for retry
        return { ok: false, error: result.error };
      }

      // Re-enable only if the service was already installed and enabled
      if (wasInstalled && wasEnabled) {
        const enableResult = await controller.perform(cfg.name, "enable");
        if (enableResult.error) {
          return { ok: false, error: enableResult.error };
        }
      }
    }

    return { ok: true, config: cfg };
  }

  /**
   * Delete a service: stop if running → uninstall OS service → remove config.
   * @returns { ok, error? }
   */
  async deleteService(name: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.configManager.get(name);
    if (!cfg) {
      return { ok: false, error: `Config "${name}" not found` };
    }

    const controller = await this.getActiveController();

    // Uninstall OS service (best-effort)
    if (controller) {
      const uninstallResult = await controller.uninstall(name);
      if (!uninstallResult.ok) {
        // Non-fatal: continue to config deletion
        console.warn(`[ServiceConfigController] uninstall warning for "${name}":`, uninstallResult.error);
      }
    }

    // Remove config file
    this.configManager.delete(name);

    return { ok: true };
  }
}
