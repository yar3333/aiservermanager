import * as fs from "fs";
import * as path from "path";
import { ExecTools, ExecResultWithCode } from "../../helpers/ExecTools";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { JournalLine, ServiceController } from "../serviceController";
import { ConfigManager } from "../configManager";

const SYSTEM_UNIT_DIR = "/etc/systemd/system";

/** Manage services via systemctl (Linux with systemd). */
export class SystemctlController implements ServiceController {
  private readonly configManager = new ConfigManager();
  private _hasSudo: boolean | null = null;

  /** Check if a service name has a custom config. */
  private hasCustomConfig(name: string): boolean {
    return this.configManager.get(name) !== null;
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "linux") return false;
    const { stdout } = await ExecTools.safeExec("systemctl --version");
    return stdout.trim().length > 0;
  }

  /**
   * Check if the process can execute privileged commands (root or passwordless sudo).
   */
  private async checkSudo(): Promise<boolean> {
    if (this._hasSudo !== null) return this._hasSudo;

    // Check if running as root (UID 0)
    const { stdout: uidOut } = await ExecTools.safeExec("id -u");
    if (uidOut.trim() === "0") {
      this._hasSudo = true;
      return true;
    }

    // Check if sudo works non-interactively (-n = no tty prompt)
    const sudoResult = await ExecTools.safeExecWithCode("sudo -n true");
    this._hasSudo = sudoResult.exitCode === 0;
    return this._hasSudo;
  }

  async getStatus(name: string): Promise<ServiceStatus> {
    const sudo = this.hasCustomConfig(name) ? "sudo " : "";

    // Check if unit file exists — append .service suffix for reliable matching
    const listResult = await ExecTools.safeExec(`${sudo}systemctl list-unit-files ${name}.service --no-legend`);
    const installed = listResult.stdout.includes(`${name}.service`);

    if (!installed) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: `Service "${name}" not found`,
      };
    }

    const [activeResult, enableResult] = await Promise.all([
      ExecTools.safeExec(`${sudo}systemctl is-active ${name}`),
      ExecTools.safeExec(`${sudo}systemctl is-enabled ${name}`),
    ]);

    const activeStdout = activeResult.stdout.trim();
    const enableStdout = enableResult.stdout.trim();

    const running = activeStdout === "active";
    const enabled = ["enabled", "static"].includes(enableStdout);

    // Capture systemd "failed" state as an error the user can see
    let error: string | undefined;
    if (activeStdout === "failed") {
      error = `Service "${name}" is in failed state — check the Journal panel for details.`;
    }

    // Try to get PID
    let pid: number | undefined;
    const pidResult = await ExecTools.safeExec(`${sudo}systemctl show ${name} --property=MainPID --value`);
    const pidStr = pidResult.stdout.trim();
    if (pidStr && pidStr !== "0") {
      pid = parseInt(pidStr, 10);
    }

    return { name, running, enabled, installed, pid, error };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    const sudo = "sudo ";

    const cmd = `${sudo}systemctl ${action} ${name}`;
    const result: ExecResultWithCode = await ExecTools.safeExecWithCode(cmd);

    if (result.exitCode !== 0) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `systemctl ${action} failed (code ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }

    const status = await this.getStatus(name);

    // After "start", verify the service is actually running
    if (action === "start" && !status.running && !status.error) {
      status.error = `Service "${name}" failed to start — check the Journal panel for details.`;
    }

    return status;
  }

  async installAndEnable(name: string, execStart: string): Promise<ServiceStatus> {
    // Verify privileges first
    const sudo = "sudo ";

    // Write unit file to /etc/systemd/system/
    const unitPath = path.join(SYSTEM_UNIT_DIR, `${name}.service`);

    const unitContent = `[Unit]
Description=ai server manager service (${name})
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

    try {
      if (this.hasCustomConfig(name)) {
        // Need sudo to write to /etc/systemd/system/
        const writeResult = await ExecTools.safeExecWithCode(
          `echo '${unitContent.replace(/'/g, "'\"'\"'")}' | sudo tee ${unitPath} > /dev/null`,
        );
        if (writeResult.exitCode !== 0) {
          return {
            name,
            running: false,
            enabled: false,
            installed: false,
            error: `Failed to write unit file: ${writeResult.stderr.trim()}`,
          };
        }
      } else {
        fs.writeFileSync(unitPath, unitContent, "utf-8");
      }
    } catch (err) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: `Failed to write unit file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Reload systemd daemon
    const reloadResult = await ExecTools.safeExecWithCode(`${sudo}systemctl daemon-reload`);
    if (reloadResult.exitCode !== 0) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `systemctl daemon-reload failed: ${reloadResult.stderr.trim()}`,
      };
    }

    // Enable the service (auto-start)
    const enableResult = await ExecTools.safeExecWithCode(`${sudo}systemctl enable ${name}`);
    if (enableResult.exitCode !== 0) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `systemctl enable failed: ${enableResult.stderr.trim()}`,
      };
    }

    return this.getStatus(name);
  }

  async uninstall(name: string): Promise<{ ok: boolean; error?: string }> {
    const sudo = this.hasCustomConfig(name) ? "sudo " : "";
    const unitPath = path.join(SYSTEM_UNIT_DIR, `${name}.service`);

    // Stop the service first (best-effort)
    await ExecTools.safeExec(`${sudo}systemctl stop ${name}`);

    // Disable the service (best-effort)
    await ExecTools.safeExec(`${sudo}systemctl disable ${name}`);

    // Remove unit file
    try {
      if (this.hasCustomConfig(name)) {
        const rmResult = await ExecTools.safeExecWithCode(`sudo rm -f ${unitPath}`);
        if (rmResult.exitCode !== 0) {
          return { ok: false, error: `Failed to remove unit file: ${rmResult.stderr.trim()}` };
        }
      } else {
        if (fs.existsSync(unitPath)) {
          fs.unlinkSync(unitPath);
        }
      }
    } catch (err) {
      return { ok: false, error: `Failed to remove unit file: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Reload systemd daemon
    const reloadResult = await ExecTools.safeExecWithCode(`${sudo}systemctl daemon-reload`);
    if (reloadResult.exitCode !== 0) {
      return { ok: false, error: `systemctl daemon-reload failed: ${reloadResult.stderr.trim()}` };
    }

    return { ok: true };
  }

  async listAvailable(): Promise<string[]> {
    const { stdout } = await ExecTools.safeExec(
      "systemctl list-unit-files --type=service --no-legend --no-pager --all",
    );

    const customNames = new Set(this.configManager.list().map((c) => c.name));
    const names: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("UNIT") || trimmed.startsWith("Hint")) continue;

      const parts = trimmed.split(/\s+/);
      const unitFile = parts[0];
      if (!unitFile) continue;

      // Strip .service suffix
      const name = unitFile.replace(/\.service$/, "");

      // Skip custom services (have a config)
      if (customNames.has(name)) continue;

      names.push(name);
    }

    return names.sort();
  }

  async getJournal(name: string, count: number = 100): Promise<JournalLine[] | { error: string }> {
    const sudo = this.hasCustomConfig(name) ? "sudo " : "";

    // journalctl with verbose ISO timestamp for parsing
    const result = await ExecTools.safeExec(
      `${sudo}journalctl -u ${name} --no-pager -n ${count} --output=short-iso 2>/dev/null || true`,
    );

    if (result.stderr && !result.stdout.trim()) {
      return { error: result.stderr.trim() || `No journal found for "${name}"` };
    }

    const lines: JournalLine[] = [];
    for (const raw of result.stdout.trim().split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;

      // Parse "2026-07-16 12:34:56.789 +0300 hostname service[pid]: message"
      // The timestamp is the first two token parts (date + time+offset)
      const match = trimmed.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[^\s]*)\s+\S+\s+\S+:\s*(.*)$/);
      if (match) {
        lines.push({ timestamp: match[1], message: match[2] });
      } else {
        // Fallback: treat entire line as message with empty timestamp
        lines.push({ timestamp: "", message: trimmed });
      }
    }

    return lines;
  }
}
