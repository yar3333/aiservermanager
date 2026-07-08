import { exec as execCallback, spawn } from "child_process";
import { promisify } from "util";

const exec = promisify(execCallback);

export interface ExecOptions {
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export class ExecTools {
  /**
   * Run a shell command safely — never throws, returns stderr on failure.
   * On Windows the shell is PowerShell; on Linux it is /bin/sh.
   */
  public static async safeExec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    return exec(command, {
      timeout: opts?.timeout ?? 10_000,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
    }).catch((err) => ({
      stdout: (err as { stdout?: string }).stdout ?? "",
      stderr: (err as { stderr?: string }).stderr ?? err.message,
    }));
  }

  /**
   * Run a PowerShell script file safely — never throws, returns stderr on failure.
   * Uses spawn to avoid shell escaping issues with complex scripts.
   */
  public static async safeExecPs1(scriptPath: string, opts?: ExecOptions): Promise<ExecResult> {
    const timeout = opts?.timeout ?? 10_000;
    return new Promise((resolve) => {
      const child = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath]);

      let stdout = "";
      let stderr = "";
      let resolved = false;

      const done = (out: ExecResult) => {
        if (!resolved) {
          resolved = true;
          resolve(out);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", () => {
        done({ stdout, stderr });
      });
      child.on("error", (err: Error) => {
        done({ stdout: "", stderr: err.message });
      });

      setTimeout(() => {
        child.kill();
        done({ stdout: "", stderr: `Timeout after ${timeout}ms` });
      }, timeout);
    });
  }
}
