import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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

describe("safeExecPs1", () => {
  if (process.platform !== "win32") {
    it.skip("skipped on non-Windows", () => {});
    return;
  }

  let ps1Path: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exectest-"));
    fs.writeFileSync(path.join(tmpDir, "hello.ps1"), 'Write-Output "hello ps1"\n');
    ps1Path = path.join(tmpDir, "hello.ps1");
  });

  it("executes a .ps1 file and returns stdout", async () => {
    const result = await ExecTools.safeExecPs1(ps1Path);
    expect(result.stdout.trim()).toBe("hello ps1");
  });

  it("returns ExecResult shape", async () => {
    const result = await ExecTools.safeExecPs1(ps1Path);
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
  });

  it("returns stderr on non-existent file", async () => {
    const result = await ExecTools.safeExecPs1("C:\\nonexistent\\path\\file.ps1", { timeout: 5000 });
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
