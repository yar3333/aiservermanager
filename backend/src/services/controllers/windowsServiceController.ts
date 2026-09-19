import { ExecTools, ExecResult, ExecResultWithCode } from "../../helpers/ExecTools";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { JournalLine, ServiceController } from "../serviceController";

/** Manage Windows services via sc.exe. */
export class WindowsServiceController implements ServiceController {
  private static readonly SC = "sc.exe";
  private _isAdmin: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    return process.platform === "win32";
  }

  /** Check if the current process is running as Administrator. */
  private async checkIsAdmin(): Promise<boolean> {
    if (this._isAdmin !== null) return this._isAdmin;

    const { stdout } = await ExecTools.safeExec(
      "[bool]([Security.Principal.WindowsPrincipal]" +
        "[Security.Principal.WindowsIdentity]::GetCurrent())" +
        ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
    );
    this._isAdmin = stdout.trim().toUpperCase() === "TRUE";
    return this._isAdmin;
  }

  async getStatus(name: string): Promise<ServiceStatus> {
    // sc.exe queryex gives STATE (RUNNING/STOPPED), START_TYPE (AUTO/DEMAND/DISABLED)
    const { stdout, stderr } = await ExecTools.safeExec(`${WindowsServiceController.SC} queryex "${name}"`);

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

    // Fallback: if sc.exe query failed (service not found), check with Get-Service
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
      return { name, running: false, enabled: false, installed: false, error: errorMsg };
    }

    return { name, running, enabled, installed: true, pid };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    const SC = WindowsServiceController.SC;
    let cmd: string;

    switch (action) {
      case "start":
        cmd = `${SC} start "${name}"`;
        break;
      case "stop":
        cmd = `${SC} stop "${name}"`;
        break;
      case "enable":
        cmd = `${SC} config "${name}" start= auto`;
        break;
      case "disable":
        cmd = `${SC} config "${name}" start= disabled`;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const result: ExecResultWithCode = await ExecTools.safeExecWithCode(cmd);

    if (result.exitCode !== 0) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `${SC} ${action} failed (code ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }

    // After start/stop, give the service a moment to transition
    if (action === "start" || action === "stop") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const status = await this.getStatus(name);

    // After "start", verify the service is actually running
    if (action === "start" && !status.running && !status.error) {
      status.error = `sc.exe start returned success, but "${name}" is not running`;
    }

    return status;
  }

  /**
   * Persist environment variables for a Windows service in
   * HKLM\SYSTEM\CurrentControlSet\Services\<name>\Environment (REG_MULTI_SZ).
   * The Service Control Manager merges these into the service process
   * environment when the service starts. Returns an error message, or null.
   */
  private async setServiceEnvironment(name: string, environment?: Record<string, string>): Promise<string | null> {
    const entries = Object.entries(environment ?? {})
      .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, value]) => `${key}=${value.replace(/[\r\n]+/g, " ")}`);

    const regKey = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}`;

    if (entries.length === 0) {
      // No variables — drop a stale value so the service does not inherit old env (best-effort)
      await ExecTools.safeExecWithCode(`reg delete "${regKey}" /v Environment /f`);
      return null;
    }

    const result: ExecResultWithCode = await ExecTools.safeExecWithCode(
      `reg add "${regKey}" /v Environment /t REG_MULTI_SZ /d "${entries.join("\\0")}" /f`,
    );
    return result.exitCode === 0 ? null : `Failed to set environment variables: ${result.stderr.trim()}`;
  }

  async install(name: string, execStart: string, environment?: Record<string, string>): Promise<ServiceStatus> {
    const SC = WindowsServiceController.SC;
    const isAdmin = await this.checkIsAdmin();
    if (!isAdmin) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: "Server is not running as Administrator. Restart with elevated privileges to install system services.",
      };
    }

    // Persist environment variables before (re)creating the service
    const envError = await this.setServiceEnvironment(name, environment);
    if (envError) {
      return { name, running: false, enabled: false, installed: false, error: envError };
    }

    // sc.exe create with demand start (disabled) — install only, no auto-start
    const createResult: ExecResultWithCode = await ExecTools.safeExecWithCode(
      `${SC} create "${name}" binPath= "${execStart}" start= demand`,
    );

    if (createResult.exitCode !== 0) {
      // Service may already exist — try sc.exe config to update
      const configResult: ExecResultWithCode = await ExecTools.safeExecWithCode(
        `${SC} config "${name}" binPath= "${execStart}" start= demand`,
      );

      if (configResult.exitCode !== 0) {
        return {
          name,
          running: false,
          enabled: false,
          installed: false,
          error: `Failed to install service: ${configResult.stderr.trim()}`,
        };
      }
      return this.getStatus(name);
    }

    return this.getStatus(name);
  }

  async installAndEnable(name: string, execStart: string, environment?: Record<string, string>): Promise<ServiceStatus> {
    const status = await this.install(name, execStart, environment);
    if (status.error) return status;

    // Enable (set to auto start)
    const enableResult: ExecResultWithCode = await ExecTools.safeExecWithCode(
      `${WindowsServiceController.SC} config "${name}" start= auto`,
    );
    if (enableResult.exitCode !== 0) {
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `sc.exe config start=auto failed: ${enableResult.stderr.trim()}`,
      };
    }

    return this.getStatus(name);
  }

  async uninstall(name: string): Promise<{ ok: boolean; error?: string }> {
    const SC = WindowsServiceController.SC;

    // Stop the service (best-effort)
    const stopResult: ExecResultWithCode = await ExecTools.safeExecWithCode(`${SC} stop "${name}"`);
    if (stopResult.exitCode === 0) {
      // Wait until the service is actually stopped (sc.exe stop is async)
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await this.getStatus(name);
        if (!status.running) break;
      }
    }

    // Delete the service
    const deleteResult: ExecResultWithCode = await ExecTools.safeExecWithCode(`${SC} delete "${name}"`);

    if (deleteResult.exitCode !== 0) {
      return {
        ok: false,
        error: `sc.exe delete failed (code ${deleteResult.exitCode}): ${deleteResult.stderr.trim() || deleteResult.stdout.trim()}`,
      };
    }

    return { ok: true };
  }

  async listAvailable(): Promise<string[]> {
    const { stdout } = await ExecTools.safeExec("Get-Service | Select-Object -ExpandProperty Name");

    const names: string[] = [];
    for (const line of stdout.split("\n")) {
      const name = line.trim();
      if (!name) continue;
      names.push(name);
    }

    return names.sort();
  }

  async getJournal(_name: string, _count: number = 100): Promise<JournalLine[] | { error: string }> {
    return { error: "Journal retrieval is not supported on Windows. Use Linux with systemd." };
  }
}
