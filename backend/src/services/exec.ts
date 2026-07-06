import { exec as execCallback } from "child_process";
import { promisify } from "util";

const exec = promisify(execCallback);

export interface ExecOptions {
  timeout?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a shell command safely — never throws, returns stderr on failure.
 * On Windows the shell is PowerShell; on Linux it is /bin/sh.
 */
export async function safeExec(command: string, opts?: ExecOptions): Promise<ExecResult> {
  return exec(command, {
    timeout: opts?.timeout ?? 10_000,
    maxBuffer: 1024 * 1024,
    shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
  }).catch((err) => ({ stdout: "", stderr: err.message }));
}
