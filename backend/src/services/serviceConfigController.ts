import { multiInject } from "inversify";
import { ServiceConfig, buildExecStart, computeServiceName } from "../models/ServiceConfig";
import { ConfigManager } from "./configManager";
import { ServiceController } from "./serviceController";

const SUFFIX_REGEX = /^[a-z0-9][a-z0-9-]{0,30}$/;

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

  /** Get a single config by suffix. */
  getConfig(suffix: string): ServiceConfig | null {
    return this.configManager.get(suffix);
  }

  private async getActiveController(): Promise<ServiceController | null> {
    for (const c of this.controllers) {
      if (await c.isAvailable()) return c;
    }
    return null;
  }

  /**
   * Create or update a service config and its OS service.
   * No suffix change — that logic lives on the frontend (delete → create).
   * @returns { ok, config?, error? }
   */
  async createOrUpdate(cfg: ServiceConfig): Promise<{ ok: boolean; config?: ServiceConfig; error?: string }> {
    // Validate suffix
    if (!SUFFIX_REGEX.test(cfg.suffix)) {
      return {
        ok: false,
        error: "Suffix must be lowercase alphanumeric with hyphens (max 31 chars, start with letter/digit)",
      };
    }

    // Validate command
    if (!cfg.command.trim()) {
      return { ok: false, error: "Command path is required" };
    }

    // Check for collision: creating with a suffix that already exists is fine (update),
    // but if it's a different config object that means someone is trying to overwrite.
    const existing = this.configManager.get(cfg.suffix);
    if (!existing) {
      // New config — nothing extra to check
    }
    // else: updating existing — just overwrite

    // Save config file
    this.configManager.save(cfg);

    // Install/update OS service
    const controller = await this.getActiveController();
    if (controller) {
      const serviceName = computeServiceName(cfg.suffix);
      const execStart = buildExecStart(cfg);
      const result = await controller.installAndEnable(serviceName, execStart);
      if (result.error) {
        // Config was saved but service install failed — keep config for retry
        return { ok: false, error: result.error };
      }
    }

    return { ok: true, config: cfg };
  }

  /**
   * Delete a service: stop if running → uninstall OS service → remove config.
   * @returns { ok, error? }
   */
  async deleteService(suffix: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.configManager.get(suffix);
    if (!cfg) {
      return { ok: false, error: `Config "${suffix}" not found` };
    }

    const controller = await this.getActiveController();

    // Uninstall OS service (best-effort)
    if (controller) {
      const serviceName = computeServiceName(suffix);
      const uninstallResult = await controller.uninstall(serviceName);
      if (!uninstallResult.ok) {
        // Non-fatal: continue to config deletion
        console.warn(`[ServiceConfigController] uninstall warning for "${serviceName}":`, uninstallResult.error);
      }
    }

    // Remove config file
    this.configManager.delete(suffix);

    return { ok: true };
  }

  /** Get the OS service name for a suffix. */
  getServiceName(suffix: string): string {
    return computeServiceName(suffix);
  }
}
