import { exec as execCallback, spawn, ChildProcess } from "child_process";
import { promisify } from "util";

const exec = promisify(execCallback);

export interface ExecOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/** Options for running an executable directly (no shell). */
export interface ExecFileOptions extends ExecOptions {
  cwd?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecResultWithCode extends ExecResult {
  exitCode: number;
}

export class ExecTools {
  /**
   * Run a shell command safely — never throws, returns stderr on failure.
   * On Windows the shell is PowerShell; on Linux it is /bin/sh.
   */
  public static async safeExec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    const baseEnv = opts?.env ? { ...process.env, ...opts.env } : undefined;
    return exec(command, {
      timeout: opts?.timeout ?? 10_000,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
      env: baseEnv,
    }).catch((err) => ({
      stdout: (err as { stdout?: string }).stdout ?? "",
      stderr: (err as { stderr?: string }).stderr ?? err.message,
    }));
  }

  /**
   * Run a shell command and return the exit code along with stdout/stderr.
   * Never throws — on failure returns whatever exitCode the process returned.
   * On Windows the shell is PowerShell; on Linux it is /bin/sh.
   */
  public static async safeExecWithCode(command: string, opts?: ExecOptions): Promise<ExecResultWithCode> {
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    return this.track(spawn(command, { shell, timeout: undefined }), opts?.timeout ?? 10_000);
  }

  /**
   * Run an executable directly, without a shell, and return its exit code.
   * Never throws.
   *
   * Use this instead of safeExecWithCode for a known program: a shell would have
   * to quote the path, and PowerShell reads a command line that starts with a
   * quoted path as an expression rather than a call ("Unexpected token …").
   */
  public static async safeExecFileWithCode(
    command: string,
    args: string[],
    opts?: ExecFileOptions,
  ): Promise<ExecResultWithCode> {
    return this.track(
      spawn(command, args, { cwd: opts?.cwd, windowsHide: true, env: opts?.env ? { ...process.env, ...opts.env } : undefined }),
      opts?.timeout ?? 10_000,
    );
  }

  /** Collect a spawned child's output and exit code, killing it once the timeout expires. */
  private static track(child: ChildProcess, timeout: number): Promise<ExecResultWithCode> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let resolved = false;

      const done = (out: ExecResultWithCode) => {
        if (!resolved) {
          resolved = true;
          resolve(out);
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ stdout, stderr, exitCode: code ?? 1 });
      });
      child.on("error", (err: Error) => {
        clearTimeout(timer);
        done({ stdout: "", stderr: err.message, exitCode: 1 });
      });

      const timer = setTimeout(() => {
        child.kill();
        done({ stdout, stderr: `Timeout after ${timeout}ms`, exitCode: 1 });
      }, timeout);
      // A finished command must not keep the process (or a test worker) alive.
      timer.unref();
    });
  }

  /**
   * Run a PowerShell script file safely — never throws, returns stderr on failure.
   * Uses spawn to avoid shell escaping issues with complex scripts.
   */
  public static async safeExecPs1(scriptPath: string, opts?: ExecOptions): Promise<ExecResult> {
    const timeout = opts?.timeout ?? 10_000;
    const baseEnv = opts?.env ? { ...process.env, ...opts.env } : undefined;
    return new Promise((resolve) => {
      const child = spawn("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], {
        env: baseEnv,
      });

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
