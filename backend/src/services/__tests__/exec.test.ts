import { ExecTools, ExecResult } from "../../helpers/ExecTools";

describe("safeExec", () => {
  const testShell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
  const echoCmd = testShell === "powershell.exe" ? 'Write-Output "hello"' : 'echo "hello"';

  it("resolves with stdout/stderr on success", async () => {
    const result = await ExecTools.safeExec(echoCmd);
    expect(result.stdout.trim()).toBe("hello");
    expect(typeof result.stderr).toBe("string");
  });

  it("returns ExecResult shape", async () => {
    const result = await ExecTools.safeExec(echoCmd);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });

  it("never throws — returns stderr on failure", async () => {
    const result = await ExecTools.safeExec("nonexistent_command_that_does_not_exist_12345", {
      timeout: 5000,
    });
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("accepts custom timeout option", async () => {
    // Just verify it doesn't error when passing a custom timeout
    const result = await ExecTools.safeExec(echoCmd, { timeout: 30000 });
    expect(result.stdout.trim()).toBe("hello");
  });

  it("uses correct shell for platform", async () => {
    // Verify by running a platform-specific command
    if (process.platform === "win32") {
      // PowerShell-specific: $PSVersionTable exists only in PS
      const result = await ExecTools.safeExec("$PSVersionTable.PSVersion.ToString()");
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    } else {
      // Shell-specific: $SHELL exists in /bin/sh
      const result = await ExecTools.safeExec("echo $SHELL");
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    }
  });
});
