import * as fs from "fs";
import * as path from "path";
import { ExecTools, ExecResultWithCode } from "../../helpers/ExecTools";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { ServiceController } from "../serviceController";
import { ConfigManager } from "../configManager";

const SYSTEM_UNIT_DIR = "/etc/systemd/system";

/** Manage services via systemctl (Linux with systemd). */
export class SystemctlController implements ServiceController {
  private readonly configManager = new ConfigManager();
  private _hasSudo: boolean | null = null;

  /** Check if a service name has a deep-managed config. */
  private isDeepManaged(name: string): boolean {
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

  /** Return "sudo " if deep-managed service; "" otherwise. */
  private async sudoPrefix(name: string): Promise<string> {
    if (this.isDeepManaged(name)) {
      const hasSudo = await this.checkSudo();
      if (!hasSudo) {
        throw new Error(
          "Cannot manage system-level service. Run server as root or configure passwordless sudo for 'systemctl'.",
        );
      }
      return "sudo ";
    }
    return "";
  }

  async getStatus(name: string): Promise<ServiceStatus> {
    const sudo = this.isDeepManaged(name) ? "sudo " : "";

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
      // Get the last journal error for this unit
      const journalResult = await ExecTools.safeExec(
        `journalctl -u ${name} --no-pager -n 3 --quiet 2>/dev/null || true`,
      );
      const journalLines = journalResult.stdout.trim().split("\n").filter(Boolean);
      const journalHint = journalLines.length > 0 ? `\n${journalLines.join("\n")}` : "";
      error = `Service "${name}" is in failed state.${journalHint}`;
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
    let sudo: string;
    try {
      sudo = await this.sudoPrefix(name);
    } catch (err) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `Privilege check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

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
      // Try to get the real reason from journalctl
      const journalResult = await ExecTools.safeExec(
        `journalctl -u ${name}.service --no-pager -n 10 --quiet 2>/dev/null || true`,
      );
      const lines = journalResult.stdout.trim().split("\n").filter(Boolean);
      // Prefer lines that explain the failure (EXEC, spawning, No such file...)
      const relevant = lines.filter((l) => l.includes("EXEC") || l.includes("spawning") || l.includes("No such file"));
      const detail = relevant.length > 0 ? relevant.join("\n") : lines.slice(-3).join("\n");
      if (detail) {
        status.error = `Service "${name}" failed to start.\n${detail}`;
      } else {
        status.error = `systemctl start returned success, but "${name}" is not running`;
      }
    }

    return status;
  }

  async installAndEnable(name: string, execStart: string): Promise<ServiceStatus> {
    // Verify privileges first
    const sudo = await this.sudoPrefix(name);

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
      if (this.isDeepManaged(name)) {
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
    const sudo = this.isDeepManaged(name) ? "sudo " : "";
    const unitPath = path.join(SYSTEM_UNIT_DIR, `${name}.service`);

    // Stop the service first (best-effort)
    await ExecTools.safeExec(`${sudo}systemctl stop ${name}`);

    // Disable the service (best-effort)
    await ExecTools.safeExec(`${sudo}systemctl disable ${name}`);

    // Remove unit file
    try {
      if (this.isDeepManaged(name)) {
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

    const deepManaged = new Set(this.configManager.list().map((c) => c.name));
    const names: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("UNIT") || trimmed.startsWith("Hint")) continue;

      const parts = trimmed.split(/\s+/);
      const unitFile = parts[0];
      if (!unitFile) continue;

      // Strip .service suffix
      const name = unitFile.replace(/\.service$/, "");

      // Skip deep-managed services (have a config)
      if (deepManaged.has(name)) continue;

      names.push(name);
    }

    return names.sort();
  }
}
