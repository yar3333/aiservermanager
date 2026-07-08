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

    return { name, running, enabled, pid };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    const cmd = `systemctl ${action} ${name}`;
    const result = await ExecTools.safeExec(cmd);

    if (result.stderr) {
      return {
        name,
        running: false,
        enabled: false,
        error: `systemctl ${action} failed: ${result.stderr.trim()}`,
      };
    }

    return this.getStatus(name);
  }
}
