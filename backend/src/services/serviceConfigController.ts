import { ServiceConfig, computeServiceName } from "../models/ServiceConfig";
import { ConfigManager } from "./configManager";
import { SystemdUserInstaller } from "./systemdUserInstaller";

const SUFFIX_REGEX = /^[a-z0-9][a-z0-9-]{0,30}$/;

/**
 * Orchestrates config CRUD + systemd unit installation.
 * Singleton — shares one ConfigManager and one SystemdUserInstaller.
 */
export class ServiceConfigController {
  private readonly configManager = new ConfigManager();
  private readonly installer = new SystemdUserInstaller();

  /** List all saved service configs. */
  listConfigs(): ServiceConfig[] {
    return this.configManager.list();
  }

  /** Get a single config by suffix. */
  getConfig(suffix: string): ServiceConfig | null {
    return this.configManager.get(suffix);
  }

  /**
   * Create or update a service config and its systemd unit.
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

    // Check for duplicate suffix (only when creating a new one)
    const existing = this.configManager.get(cfg.suffix);
    if (existing) {
      // Editing existing — check that no other config has same suffix (shouldn't happen)
    }

    // Save config file
    this.configManager.save(cfg);

    // Install systemd unit
    const installResult = await this.installer.install(cfg);
    if (!installResult.ok) {
      // Config was saved but unit install failed — keep config for retry
      return { ok: false, error: installResult.error };
    }

    return { ok: true, config: cfg };
  }

  /**
   * Delete a service: stop if running → remove unit → remove config.
   * @returns { ok, error? }
   */
  async deleteService(suffix: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.configManager.get(suffix);
    if (!cfg) {
      return { ok: false, error: `Config "${suffix}" not found` };
    }

    // Stop the service first (best-effort)
    await this.installer.stopService(suffix);

    // Remove systemd unit
    const uninstallResult = await this.installer.uninstall(suffix);
    if (!uninstallResult.ok) {
      return { ok: false, error: uninstallResult.error };
    }

    // Remove config file
    this.configManager.delete(suffix);

    return { ok: true };
  }

  /** Get the systemd service name for a suffix. */
  getServiceName(suffix: string): string {
    return computeServiceName(suffix);
  }
}
