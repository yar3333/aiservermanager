import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExecTools, ExecResultWithCode } from "../../helpers/ExecTools";
import { homeDirectory } from "../../helpers/homeDirectory";
import { ServerIdentity } from "../../helpers/ServerIdentity";
import { ServiceAction, ServiceStatus } from "../../models/ServiceStatus";
import { InstallOptions } from "../../models/ServiceConfig";
import { JournalLine, ServiceController } from "../serviceController";
import {
  buildWinSwXml,
  logonRightIdentity,
  parseServiceAccount,
  resolveWorkingDirectory,
  WinSwServiceAccount,
  WinSwServiceSpec,
} from "../helpers/winswConfig";
import { parseWinSwLogLine } from "../helpers/winswLog";

const SC = "sc.exe";

/** Per-service WinSW host directories: ~/.config/aiservermanager/winsw/<name>/. */
const WINSW_ROOT = path.join(homeDirectory(), ".config", "aiservermanager", "winsw");

/**
 * Packaged WinSW binary. From src/services/controllers (ts-node-dev) and from
 * dist/services/controllers (build copies src/files to dist/files) this
 * resolves to files/winsw/ inside the same tree the code runs from.
 * Override with AISERVERMANAGER_WINSW when the binary lives elsewhere.
 */
const WINSW_BINARY =
  process.env.AISERVERMANAGER_WINSW ?? path.resolve(__dirname, "../../files/winsw/WinSW-x64.exe");

/** Grants "Log on as a service" to a service account (see grantLogonServiceRight.ps1). */
const GRANT_RIGHT_SCRIPT = path.resolve(__dirname, "../../files/grantLogonServiceRight.ps1");

/** How many trailing bytes of a log file to read when tailing the journal. */
const JOURNAL_TAIL_BYTES = 256 * 1024;

/**
 * Explain a rejected service account at registration. Install has already given
 * the account its logon right by this point, so 1069/1385 here means the SCM was
 * handed a password it does not accept for that account.
 */
function serviceAccountHint(account: WinSwServiceAccount | undefined, output: string): string {
  if (!account) return "";
  if (!/1069|1385|logon|password|account name|privileged account/i.test(output)) return "";

  const fullName = account.domain ? `${account.domain}\\${account.user}` : account.user;
  return (
    ` — the Service Control Manager did not accept the password typed for "${fullName}". ` +
    `Install it again with the current password. If the account name is wrong, ` +
    `correct it in the service settings first.`
  );
}

/**
 * Explain a refused start: the account registered under the service could not be
 * logged on, which happens when its password changed after the registration or
 * when it lost the right that install granted it (a Group Policy refresh does that).
 */
function logonFailureHint(action: ServiceAction, output: string): string {
  if (action !== "start") return "";
  if (!/1069|1385/i.test(output)) return "";

  return (
    ` — the Service Control Manager cannot log on as the account this service is registered with. ` +
    `Its password changed since the registration, or it lost the "Log on as a service" right. ` +
    `Use Reinstall and type the current password, or grant the right in secpol.msc ` +
    `(Local Policies → User Rights Assignment); the System log event says which.`
  );
}

/**
 * Manage Windows services.
 *
 * Real OS services are queried and controlled through sc.exe. Custom services
 * from configs are installed through WinSW (Windows Service Wrapper) because
 * the Service Control Manager only accepts an executable that reports its
 * status — a plain program or a .cmd launcher (ComfyUI, llama-server, …) is
 * not one, and `sc create` for it yields a service that never starts.
 */
export class WindowsServiceController implements ServiceController {
  async isAvailable(): Promise<boolean> {
    return process.platform === "win32";
  }

  private serviceDir(name: string): string {
    return path.join(WINSW_ROOT, name);
  }

  /** WinSW derives the config path from its own executable name, hence per-service copies. */
  private wrapperBinary(name: string): string {
    return path.join(this.serviceDir(name), `${name}.exe`);
  }

  private wrapperConfig(name: string): string {
    return path.join(this.serviceDir(name), `${name}.xml`);
  }

  /** Refuse to run sc.exe actions that an unelevated token is denied anyway. */
  private async privilegeFailure(name: string, action: string): Promise<ServiceStatus> {
    const identity = await ServerIdentity.describe();
    return {
      name,
      running: false,
      enabled: false,
      installed: true,
      error:
        `Backend is not running as Administrator (PID ${identity.pid}, ${identity.host}:${identity.port}). ` +
        `Stop every backend instance and start one elevated — port ${identity.port} may still be held by ` +
        `an older instance. Cannot ${action} "${name}".`,
    };
  }

  async getStatus(name: string): Promise<ServiceStatus> {
    // sc.exe queryex gives STATE and PID; the start type comes from Get-Service below.
    const { stdout, stderr } = await ExecTools.safeExec(`${SC} queryex "${name}"`);

    const lines = stdout.split("\n");
    let running = false;
    let pid: number | undefined;
    let foundState = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // sc.exe pads the field name, so the value sits after the colon of
      // "        STATE              : 1  STOPPED" / "        PID                : 0".
      const colon = trimmed.indexOf(":");
      if (colon < 0) continue;
      const field = trimmed.slice(0, colon).trim().toUpperCase();
      const value = trimmed.slice(colon + 1).trim().toUpperCase();

      if (field === "STATE") {
        foundState = true;
        running = value.includes("RUNNING");
      }

      // A service without a process reports PID 0, which is no process to show.
      if (field === "PID") {
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) pid = parsed;
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
    }

    if (!foundState) {
      const errorMsg = stderr.trim() ? `Service "${name}" not found: ${stderr.trim()}` : `Service "${name}" not found`;
      return { name, running: false, enabled: false, installed: false, error: errorMsg };
    }

    // "enabled" here means "starts on boot", the systemd meaning: only Automatic does.
    // Manual is what install() registers and what "disable" leaves behind, and a service
    // in that state is startable by hand but boots on its own never.
    const startModeResult = await ExecTools.safeExec(
      `Get-Service "${name}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty StartType`,
    );
    const enabled = startModeResult.stdout.trim().toUpperCase() === "AUTOMATIC";

    return { name, running, enabled, installed: true, pid };
  }

  async perform(name: string, action: ServiceAction): Promise<ServiceStatus> {
    if (!(await ServerIdentity.isPrivileged())) {
      return this.privilegeFailure(name, action);
    }

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
        // Manual, not "disabled": like `systemctl disable`, this only takes the autostart
        // away. A service set to Disabled cannot be started at all (error 1058), so the
        // Start button in the dashboard would be dead until the service is enabled again.
        cmd = `${SC} config "${name}" start= demand`;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const result: ExecResultWithCode = await ExecTools.safeExecWithCode(cmd);

    if (result.exitCode !== 0) {
      const output = result.stderr.trim() || result.stdout.trim();
      return {
        name,
        running: false,
        enabled: false,
        installed: true,
        error: `${SC} ${action} failed (code ${result.exitCode}): ${output}${logonFailureHint(action, output)}`,
      };
    }

    // After start/stop, give the service a moment to transition
    if (action === "start" || action === "stop") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const status = await this.getStatus(name);

    // After "start", verify the service is actually running
    if (action === "start" && !status.running && !status.error) {
      status.error = `${SC} start returned success, but "${name}" is not running`;
    }

    return status;
  }

  /**
   * Drop the legacy HKLM\..\Services\<name>\Environment value written by older
   * versions of this controller. Variables now reach the process through the
   * WinSW <env> elements, and a leftover key would keep being merged in by the
   * Service Control Manager after a reinstall.
   */
  private async clearLegacyEnvironmentKey(name: string): Promise<void> {
    await ExecTools.safeExecWithCode(
      `reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Services\\${name}" /v Environment /f`,
    );
  }

  /** Copy the packaged WinSW binary next to the service config under the service's own name. */
  private placeWrapperBinary(name: string): string | null {
    const target = this.wrapperBinary(name);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }

    // A hard link keeps the 18 MB binary from being duplicated per service.
    try {
      fs.linkSync(WINSW_BINARY, target);
      return null;
    } catch (err) {
      try {
        fs.copyFileSync(WINSW_BINARY, target);
        return null;
      } catch (copyErr) {
        return `Failed to place WinSW host at ${target}: ${copyErr instanceof Error ? copyErr.message : String(copyErr)} (hard link failed: ${err instanceof Error ? err.message : String(err)})`;
      }
    }
  }

  /**
   * Install a custom service as a WinSW-hosted Windows service. Replaces an
   * existing registration (including one made by an older version of this
   * controller), so calling it again re-applies the config.
   */
  async install(name: string, execStart: string, options?: InstallOptions): Promise<ServiceStatus> {
    if (!(await ServerIdentity.isPrivileged())) {
      return {
        ...(await this.privilegeFailure(name, "install")),
        installed: false,
      };
    }

    if (!fs.existsSync(WINSW_BINARY)) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error:
          `WinSW host is missing at ${WINSW_BINARY}. ` +
          `Fetch it with "pwsh scripts/get-winsw.ps1" or point AISERVERMANAGER_WINSW at a WinSW executable.`,
      };
    }

    const executable = (options?.executable ?? execStart).trim();
    const args = options?.args ?? [];
    const workingDirectory = resolveWorkingDirectory(options?.workingDirectory, executable);

    if (!fs.existsSync(workingDirectory)) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: `Working directory "${workingDirectory}" does not exist — set unit.cwd= in the service config.`,
      };
    }

    const { account, error: accountError } = parseServiceAccount(options?.user, options?.runAsPassword);
    if (accountError) {
      return { name, running: false, enabled: false, installed: false, error: accountError };
    }

    // Registering the service does not make the account allowed to log on as one,
    // and without that right every start fails with 1069 — so get it out of the
    // way before touching the registration.
    if (account) {
      const rightError = await this.grantLogonRight(account);
      if (rightError) {
        return { name, running: false, enabled: false, installed: false, error: rightError };
      }
    }

    const priorStatus = await this.getStatus(name);
    if (priorStatus.installed) {
      const removed = await this.removeRegistration(name);
      if (!removed.ok) {
        return { ...priorStatus, error: removed.error };
      }
    }

    const dir = this.serviceDir(name);
    fs.mkdirSync(dir, { recursive: true });

    const spec: WinSwServiceSpec = {
      id: name,
      displayName: name,
      description: `ai server manager service (${name})`,
      executable,
      args,
      workingDirectory,
      environment: options?.environment,
      serviceAccount: account,
      stopCommand: options?.stopCommand,
      restart: options?.restart,
      logDirectory: dir,
    };

    const xml = buildWinSwXml(spec);

    try {
      fs.writeFileSync(this.wrapperConfig(name), xml, "utf-8");
    } catch (err) {
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: `Failed to write WinSW config: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const placementError = this.placeWrapperBinary(name);
    if (placementError) {
      return { name, running: false, enabled: false, installed: false, error: placementError };
    }

    await this.clearLegacyEnvironmentKey(name);

    const installResult: ExecResultWithCode = await ExecTools.safeExecFileWithCode(
      this.wrapperBinary(name),
      ["install"],
      { timeout: 60_000, cwd: dir },
    );

    if (installResult.exitCode !== 0) {
      const output = installResult.stderr.trim() || installResult.stdout.trim();
      return {
        name,
        running: false,
        enabled: false,
        installed: false,
        error: `WinSW install failed (code ${installResult.exitCode}): ${output}${serviceAccountHint(account, output)}`,
      };
    }

    const status = await this.getStatus(name);
    if (!status.installed) {
      return { ...status, installed: false, error: `WinSW installed "${name}", but the service is not registered` };
    }

    this.dropAccountPassword(spec);
    return status;
  }

  /**
   * Give a run-as account the "Log on as a service" right. The Service Control
   * Manager refuses to log the account on (start fails with 1069, System log
   * event 7041) until it has the right, and registering the service does not
   * grant it. The account is passed to the script through the environment, so
   * neither the name nor a password ever appears in a command line.
   */
  private async grantLogonRight(account: WinSwServiceAccount): Promise<string | undefined> {
    // COMPUTERNAME is the NetBIOS name the account API wants; os.hostname() can
    // return a DNS alias that resolves to nothing.
    const identity = logonRightIdentity(account, process.env.COMPUTERNAME ?? os.hostname());
    const { stdout, stderr } = await ExecTools.safeExecPs1(GRANT_RIGHT_SCRIPT, {
      timeout: 60_000,
      env: { SM_ACCOUNT_DOMAIN: identity.domain ?? "", SM_ACCOUNT_NAME: identity.user },
    });

    const output = (stdout.trim() || stderr.trim()).trim();
    if (output.startsWith("OK")) return undefined;

    const fullName = identity.domain ? `${identity.domain}\\${identity.user}` : identity.user;
    return (
      output +
      ` — "${fullName}" cannot be given the "Log on as a service" right, so the service ` +
      `could never start. Grant the right in secpol.msc (Local Policies → User Rights ` +
      `Assignment) or run the backend elevated and install again.`
    );
  }

  /**
   * Rewrite the wrapper config without the account password once the service is
   * registered: the Service Control Manager keeps its own protected copy from
   * that point on, so nothing readable is left on disk. A later re-registration
   * is given the password again by the caller that has it.
   */
  private dropAccountPassword(spec: WinSwServiceSpec): void {
    if (!spec.serviceAccount?.password) return;

    const configPath = this.wrapperConfig(spec.id);
    try {
      fs.writeFileSync(
        configPath,
        buildWinSwXml({ ...spec, serviceAccount: { ...spec.serviceAccount, password: "" } }),
        "utf-8",
      );
    } catch (err) {
      console.warn(
        `[WinSW] installed "${spec.id}", but could not remove the account password from ${configPath}:`,
        err,
      );
    }
  }

  async installAndEnable(name: string, execStart: string, options?: InstallOptions): Promise<ServiceStatus> {
    const status = await this.install(name, execStart, options);
    if (status.error) return status;

    const enableResult: ExecResultWithCode = await ExecTools.safeExecWithCode(
      `${SC} config "${name}" start= auto`,
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

  /** Remove the OS registration, preferring WinSW so its wrapper files are cleaned up too. */
  private async removeRegistration(name: string): Promise<{ ok: boolean; error?: string }> {
    const wrapper = this.wrapperBinary(name);

    if (fs.existsSync(wrapper) && fs.existsSync(this.wrapperConfig(name))) {
      const result: ExecResultWithCode = await ExecTools.safeExecFileWithCode(wrapper, ["uninstall"], {
        timeout: 60_000,
        cwd: path.dirname(wrapper),
      });
      if (result.exitCode === 0) {
        return { ok: true };
      }
      // Fall through to sc.exe — the wrapper may be stale (service deleted by hand).
      const fallback: ExecResultWithCode = await ExecTools.safeExecWithCode(`${SC} delete "${name}"`);
      if (fallback.exitCode === 0) {
        return { ok: true };
      }
      return {
        ok: false,
        error: `WinSW uninstall failed (code ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }

    const result: ExecResultWithCode = await ExecTools.safeExecWithCode(`${SC} delete "${name}"`);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: `${SC} delete failed (code ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }
    return { ok: true };
  }

  async uninstall(name: string): Promise<{ ok: boolean; error?: string }> {
    if (!(await ServerIdentity.isPrivileged())) {
      const identity = await ServerIdentity.describe();
      return {
        ok: false,
        error:
          `Backend is not running as Administrator (PID ${identity.pid}). ` +
          `Stop every backend instance and start one elevated to uninstall "${name}".`,
      };
    }

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

    const removed = await this.removeRegistration(name);
    if (!removed.ok) {
      return removed;
    }

    await this.clearLegacyEnvironmentKey(name);
    this.removeWrapperFiles(name);

    return { ok: true };
  }

  /** Delete the WinSW wrapper and config; logs are kept so the journal stays readable. */
  private removeWrapperFiles(name: string): void {
    for (const file of [this.wrapperBinary(name), this.wrapperConfig(name)]) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Leftover wrapper files are harmless — the next install overwrites them.
      }
    }
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

  /** Read the last bytes of a log file without loading a rolled 10 MB file whole. */
  private readTail(filePath: string): string {
    const size = fs.statSync(filePath).size;
    const length = Math.min(size, JOURNAL_TAIL_BYTES);
    const buffer = Buffer.alloc(length);

    const handle = fs.openSync(filePath, "r");
    try {
      fs.readSync(handle, buffer, 0, length, Math.max(0, size - length));
    } finally {
      fs.closeSync(handle);
    }

    const text = buffer.toString("utf-8");
    // Drop a leading partial line when the tail starts mid-file.
    return size > length ? text.slice(text.indexOf("\n") + 1) : text;
  }

  /** Newest WinSW log of a service; stdout beats stderr, otherwise the freshest file wins. */
  private pickLogFile(dir: string, name: string): string | null {
    const candidates = fs
      .readdirSync(dir)
      .filter((file) => file.startsWith(`${name}.`) && file.includes(".log"))
      .map((file) => ({ file, full: path.join(dir, file), mtime: fs.statSync(path.join(dir, file)).mtimeMs }));

    if (candidates.length === 0) return null;

    const out = candidates.find((c) => c.file === `${name}.out.log`);
    if (out) return out.full;

    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].full;
  }

  async getJournal(name: string, count: number = 100): Promise<JournalLine[] | { error: string }> {
    const dir = this.serviceDir(name);
    if (!fs.existsSync(dir)) {
      return {
        error: `No WinSW logs for "${name}" — install it through ai server manager to get a journal.`,
      };
    }

    const logFile = this.pickLogFile(dir, name);
    if (!logFile) {
      return { error: `No WinSW logs written for "${name}" yet` };
    }

    let text: string;
    try {
      text = this.readTail(logFile);
    } catch (err) {
      return { error: `Failed to read ${logFile}: ${err instanceof Error ? err.message : String(err)}` };
    }

    // WinSW writes raw program output without timestamps; the file's own
    // modification time is the only stamp available for those lines, while the
    // lines WinSW writes itself carry the time of the event.
    const fileTimestamp = new Date(fs.statSync(logFile).mtimeMs).toISOString();
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-count)
      .map((line) => parseWinSwLogLine(line, fileTimestamp));

    return lines;
  }
}
