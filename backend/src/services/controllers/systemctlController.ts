import * as fs from "fs";
import * as path from "path";
import { ExecTools } from "../../helpers/ExecTools";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { ServiceController } from "../serviceController";

/** Manage services via systemctl (Linux with systemd). */
export class SystemctlController implements ServiceController {
  async isAvailable(): Promise<boolean> {
    if (process.platform !== "linux") return false;
    const { stdout } = await ExecTools.safeExec("systemctl --version");
    return stdout.trim().length > 0;
  }

  async getStatus(name: string): Promise<ServiceStatus> {
    // Check if unit file exists at all
    const listResult = await ExecTools.safeExec(`systemctl list-unit-files ${name} --no-legend`);
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
      ExecTools.safeExec(`systemctl is-active ${name}`),
      ExecTools.safeExec(`systemctl is-enabled ${name}`),
    ]);

    const activeStdout = activeResult.stdout.trim();
    const enableStdout = enableResult.stdout.trim();

    const running = activeStdout === "active";
    const enabled = ["enabled", "static"].includes(enableStdout);

    // Try to get PID
    let pid: number | undefined;
    const pidResult = await ExecTools.safeExec(`systemctl show ${name} --property=MainPID --value`);
    const pidStr = pidResult.stdout.trim();
    if (pidStr && pidStr !== "0") {
      pid = parseInt(pidStr, 10);
    }

    return { name, running, enabled, installed, pid };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    const cmd = `systemctl ${action} ${name}`;
    const result = await ExecTools.safeExec(cmd);

    if (result.stderr) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `systemctl ${action} failed: ${result.stderr.trim()}`,
      };
    }

    return this.getStatus(name);
  }

  async installService(name: string): Promise<{ ok: boolean; error?: string }> {
    // On Linux, aism-llama services are installed via systemdUserInstaller (unit file on disk).
    // This controller method is a no-op because the installer handles unit creation.
    // We delegate to SystemdUserInstaller from the manager layer.
    return { ok: false, error: "Use SystemdUserInstaller to install aism-llama services" };
  }

  async installAndEnable(name: string, execStart: string): Promise<ServiceStatus> {
    const systemdUserDir = path.join(process.env.HOME ?? "", ".config", "systemd", "user");

    if (!fs.existsSync(systemdUserDir)) {
      fs.mkdirSync(systemdUserDir, { recursive: true });
    }

    const unitContent = `[Unit]
Description=aism-llama service (${name})
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;

    const unitPath = path.join(systemdUserDir, `${name}.service`);

    try {
      fs.writeFileSync(unitPath, unitContent, "utf-8");
    } catch (err) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: `Failed to write unit file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Reload systemd user daemon
    await ExecTools.safeExec("systemctl --user daemon-reload");

    // Enable the service (auto-start)
    const enableResult = await ExecTools.safeExec(`systemctl --user enable ${name}`);
    if (enableResult.stderr) {
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
}
