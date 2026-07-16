import * as fs from "fs";
import * as path from "path";
import { ExecTools, ExecResultWithCode } from "../../helpers/ExecTools";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { ServiceController } from "../serviceController";

const LLAMA_PREFIX = "aism-llama-";
const SYSTEM_UNIT_DIR = "/etc/systemd/system";

/** Manage services via systemctl (Linux with systemd). */
export class SystemctlController implements ServiceController {
  private _hasSudo: boolean | null = null;

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

  /** Return "sudo " if aism-llama service; "" otherwise. */
  private async sudoPrefix(name: string): Promise<string> {
    if (name.startsWith(LLAMA_PREFIX)) {
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
    const sudo = name.startsWith(LLAMA_PREFIX) ? "sudo " : "";

    // Check if unit file exists
    const listResult = await ExecTools.safeExec(`${sudo}systemctl list-unit-files ${name} --no-legend`);
    const installed = listResult.stdout.includes(name);

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

    // Try to get PID
    let pid: number | undefined;
    const pidResult = await ExecTools.safeExec(`${sudo}systemctl show ${name} --property=MainPID --value`);
    const pidStr = pidResult.stdout.trim();
    if (pidStr && pidStr !== "0") {
      pid = parseInt(pidStr, 10);
    }

    return { name, running, enabled, installed, pid };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    const sudo = await this.sudoPrefix(name);
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

    return this.getStatus(name);
  }

  async installAndEnable(name: string, execStart: string): Promise<ServiceStatus> {
    // Verify privileges first
    const sudo = await this.sudoPrefix(name);

    // Write unit file to /etc/systemd/system/
    const unitPath = path.join(SYSTEM_UNIT_DIR, `${name}.service`);

    const unitContent = `[Unit]
Description=aism-llama service (${name})
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
      if (name.startsWith(LLAMA_PREFIX)) {
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
    const sudo = name.startsWith(LLAMA_PREFIX) ? "sudo " : "";
    const unitPath = path.join(SYSTEM_UNIT_DIR, `${name}.service`);

    // Stop the service first (best-effort)
    await ExecTools.safeExec(`${sudo}systemctl stop ${name}`);

    // Disable the service (best-effort)
    await ExecTools.safeExec(`${sudo}systemctl disable ${name}`);

    // Remove unit file
    try {
      if (name.startsWith(LLAMA_PREFIX)) {
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
}
