import * as fs from "fs";
import * as path from "path";
import { ExecTools } from "../helpers/ExecTools";
import { ServiceConfig, computeServiceName } from "../models/ServiceConfig";

const SYSTEMD_USER_DIR = path.join(process.env.HOME ?? "", ".config", "systemd", "user");

/**
 * Generates and installs user-level systemd unit files for llama.cpp services.
 * Unit files go to ~/.config/systemd/user/aism-llama-<suffix>.service
 */
export class SystemdUserInstaller {
  /** Build the systemd unit file content from a config. */
  private buildUnit(cfg: ServiceConfig): string {
    const serviceName = computeServiceName(cfg.suffix);
    const args = Object.entries(cfg.flags)
      .map(([key, value]) => {
        if (value.includes(" ")) {
          return `${key}='${value}'`;
        }
        return `${key}=${value}`;
      })
      .join(" ");

    const execStart = args ? `${cfg.command} ${args}` : cfg.command;

    return `[Unit]
Description=llama.cpp server (${cfg.suffix})
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5
Environment=HOME=${process.env.HOME ?? ""}

[Install]
WantedBy=default.target
`;
  }

  /** Get the unit file path for a suffix. */
  private unitPath(suffix: string): string {
    return path.join(SYSTEMD_USER_DIR, `${computeServiceName(suffix)}.service`);
  }

  /** Write the unit file and reload systemd daemon. */
  async install(cfg: ServiceConfig): Promise<{ ok: boolean; error?: string }> {
    if (!fs.existsSync(SYSTEMD_USER_DIR)) {
      fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true });
    }

    const unitContent = this.buildUnit(cfg);
    const p = this.unitPath(cfg.suffix);

    try {
      fs.writeFileSync(p, unitContent, "utf-8");
    } catch (err) {
      return {
        ok: false,
        error: `Failed to write unit file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Reload systemd user daemon
    const result = await ExecTools.safeExec("systemctl --user daemon-reload");
    if (result.stderr) {
      return { ok: false, error: `daemon-reload failed: ${result.stderr.trim()}` };
    }

    return { ok: true };
  }

  /** Remove the unit file and reload daemon. */
  async uninstall(suffix: string): Promise<{ ok: boolean; error?: string }> {
    const p = this.unitPath(suffix);

    if (!fs.existsSync(p)) {
      return { ok: true }; // Already removed
    }

    try {
      fs.unlinkSync(p);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to remove unit file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const result = await ExecTools.safeExec("systemctl --user daemon-reload");
    if (result.stderr) {
      return { ok: false, error: `daemon-reload failed: ${result.stderr.trim()}` };
    }

    return { ok: true };
  }

  /** Stop the service if it is running (best-effort). */
  async stopService(suffix: string): Promise<void> {
    const serviceName = computeServiceName(suffix);
    await ExecTools.safeExec(`systemctl --user stop ${serviceName}`);
  }
}
