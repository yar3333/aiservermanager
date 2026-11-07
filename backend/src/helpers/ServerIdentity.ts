import { ExecTools } from "./ExecTools";

/** How the running backend process is identified to the UI. */
export interface ServerIdentityInfo {
  pid: number;
  platform: NodeJS.Platform;
  host: string;
  port: number;
  /** ISO timestamp of when this backend process started. */
  startedAt: string;
  /** Whether the process can install/control OS services. */
  privileged: boolean;
}

/**
 * Identity of the running backend — PID, listen address, start time and
 * privilege level.
 *
 * The dashboard can be served by a stale instance (an older dev server that
 * already holds the port), so the UI needs to say which process answers its
 * requests and whether that process can control services at all.
 */
export class ServerIdentity {
  private static readonly startedAt = new Date();
  private static privileged: boolean | null = null;

  static get port(): number {
    return parseInt(process.env.PORT ?? "4243", 10);
  }

  static get host(): string {
    return process.env.HOST ?? "127.0.0.1";
  }

  /**
   * Whether the process may manage OS services: Administrator on Windows,
   * root or passwordless sudo on Linux. The answer cannot change while the
   * process runs, so it is cached once known.
   */
  public static async isPrivileged(): Promise<boolean> {
    if (this.privileged !== null) return this.privileged;

    if (process.platform === "win32") {
      const { stdout } = await ExecTools.safeExec(
        "[bool]([Security.Principal.WindowsPrincipal]" +
          "[Security.Principal.WindowsIdentity]::GetCurrent())" +
          ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      );
      const answer = stdout.trim().toUpperCase();
      if (answer !== "TRUE" && answer !== "FALSE") return false;
      this.privileged = answer === "TRUE";
      return this.privileged;
    }

    const { stdout } = await ExecTools.safeExec("id -u");
    if (stdout.trim() === "0") {
      this.privileged = true;
      return true;
    }

    const sudo = await ExecTools.safeExecWithCode("sudo -n true");
    if (sudo.exitCode === 0) {
      this.privileged = true;
    }
    return this.privileged ?? false;
  }

  /** Snapshot of the process identity for the dashboard. */
  public static async describe(): Promise<ServerIdentityInfo> {
    return {
      pid: process.pid,
      platform: process.platform,
      host: this.host,
      port: this.port,
      startedAt: this.startedAt.toISOString(),
      privileged: await this.isPrivileged(),
    };
  }
}
