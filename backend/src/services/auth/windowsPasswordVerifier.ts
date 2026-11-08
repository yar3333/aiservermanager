import * as path from "path";
import { injectable } from "inversify";
import { ExecTools } from "../../helpers/ExecTools";
import { resolveAuthAccount } from "./authAccount";
import { PasswordVerifier, VerifyOutcome } from "./passwordVerifier";

/**
 * The script itself answers in milliseconds; this only has to cover a cold
 * PowerShell start. It used to be 10 s, which the previous script reached (and
 * exceeded) on every attempt, so a misconfigured account surfaced as a timeout.
 */
const VERIFY_TIMEOUT_MS = 30_000;

/**
 * Verify password against the local SAM through LogonUser (see validatePassword.ps1).
 * Credentials travel in environment variables, never on the command line.
 */
@injectable()
export class WindowsPasswordVerifier implements PasswordVerifier {
  private readonly scriptPath = path.resolve(__dirname, "../../files/validatePassword.ps1");

  async verify(password: string): Promise<VerifyOutcome> {
    // Pinned to win32 rather than process.platform: the suite runs wherever CI
    // happens to be, and what decides whether a service account has a password
    // is the platform this strategy serves, not the host running the tests.
    const resolved = resolveAuthAccount(process.env, "win32");
    if ("error" in resolved) {
      console.error(`[WindowsPasswordVerifier] ${resolved.error}`);
      return { status: "error", message: resolved.error };
    }

    const { account } = resolved;
    const result = await ExecTools.safeExecPs1(this.scriptPath, {
      timeout: VERIFY_TIMEOUT_MS,
      env: { SM_USERNAME: account.user, SM_DOMAIN: account.domain ?? "", SM_PASSWORD: password },
    });

    const answer = result.stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
    if (answer === "OK") {
      console.log(`[WindowsPasswordVerifier] auth successful for ${account.user}`);
      return { status: "ok" };
    }
    if (answer.startsWith("FAIL")) {
      console.error(`[WindowsPasswordVerifier] auth denied for ${account.user} (${answer})`);
      return { status: "denied", detail: answer };
    }

    // Anything else — ERROR <code>, a PowerShell that failed to load the script,
    // or nothing at all — is this box's setup, not a wrong password.
    const detail = answer || "no output";
    console.error(
      `[WindowsPasswordVerifier] could not verify ${account.user}: ${detail}` +
        (result.stderr ? ` — ${result.stderr.trim()}` : ""),
    );
    return { status: "error", message: `Password check failed (${detail})` };
  }
}
