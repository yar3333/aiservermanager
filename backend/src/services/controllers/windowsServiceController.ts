import { ExecTools } from "../../helpers/ExecTools";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { ServiceController } from "../serviceController";

/** Manage Windows services via PowerShell SC cmdlet. */
export class WindowsServiceController implements ServiceController {
  async isAvailable(): Promise<boolean> {
    return process.platform === "win32";
  }

  async getStatus(name: string): Promise<ServiceStatus> {
    // SC query gives STATE (RUNNING/STOPPED), START (AUTO/DEMAND/DISABLED)
    const { stdout, stderr } = await ExecTools.safeExec(`sc queryex "${name}"`);

    const lines = stdout.split("\n");
    let running = false;
    let enabled = false;
    let pid: number | undefined;
    let foundState = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // STATE line: "        STATE: 4 RUNNING" or "        STATE: 1 STOPPED"
      if (trimmed.startsWith("STATE:")) {
        foundState = true;
        const parts = trimmed.split(/\s+/);
        const state = parts[parts.length - 1]?.toUpperCase();
        running = state === "RUNNING";
      }

      // START_TYPE line: "        START_TYPE: 2 AUTO_START"
      if (trimmed.startsWith("START_TYPE:")) {
        const parts = trimmed.split(/\s+/);
        const startType = parts[parts.length - 1]?.toUpperCase();
        enabled = startType !== "DISABLED";
      }

      // PID line: "        PID: 1234"
      if (trimmed.startsWith("PID:")) {
        const pidStr = trimmed.split(/\s+/)[1];
        if (pidStr) {
          pid = parseInt(pidStr, 10);
        }
      }
    }

    // Fallback: if SC query failed (service not found), check with Get-Service
    if (!foundState) {
      const psResult = await ExecTools.safeExec(
        `Get-Service "${name}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status`,
      );
      const status = psResult.stdout.trim().toUpperCase();
      if (status) {
        running = status === "RUNNING";
        foundState = true;
      }

      if (foundState) {
        const startModeResult = await ExecTools.safeExec(
          `Get-Service "${name}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty StartType`,
        );
        const startMode = startModeResult.stdout.trim().toUpperCase();
        if (startMode) {
          enabled = startMode !== "DISABLED";
        }
      }
    }

    if (!foundState) {
      const errorMsg = stderr.trim() ? `Service "${name}" not found: ${stderr.trim()}` : `Service "${name}" not found`;
      return { name, running: false, enabled: false, error: errorMsg };
    }

    return { name, running, enabled, pid };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    let cmd: string;

    switch (action) {
      case "start":
        cmd = `sc start "${name}"`;
        break;
      case "stop":
        cmd = `sc stop "${name}"`;
        break;
      case "enable":
        cmd = `sc config "${name}" start= auto`;
        break;
      case "disable":
        cmd = `sc config "${name}" start= disabled`;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const result = await ExecTools.safeExec(cmd);

    if (result.stderr) {
      return {
        name,
        running: false,
        enabled: false,
        error: `sc ${action} failed: ${result.stderr.trim()}`,
      };
    }

    // After start/stop, give the service a moment to transition
    if (action === "start" || action === "stop") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return this.getStatus(name);
  }
}
