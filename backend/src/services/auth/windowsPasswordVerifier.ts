import * as os from "os";
import * as path from "path";
import { injectable } from "inversify";
import { ExecTools } from "../../helpers/ExecTools";
import { PasswordVerifier } from "./passwordVerifier";

/**
 * Verify password against the local Windows SAM via .NET PrincipalContext.
 * Password is passed through an environment variable to avoid shell escaping.
 */
@injectable()
export class WindowsPasswordVerifier implements PasswordVerifier {
  private readonly username = os.userInfo().username;
  private readonly scriptPath = path.resolve(__dirname, "../../files/validatePassword.ps1");

  async verify(password: string): Promise<boolean> {
    const result = await ExecTools.safeExecPs1(this.scriptPath, {
      timeout: 10_000,
      env: { SM_PASSWORD: password, USERNAME: this.username },
    });

    const ok = result.stdout.trim() === "OK";
    if (ok) {
      console.log(`[WindowsPasswordVerifier] auth successful for ${this.username}`);
    } else {
      console.error(
        `[WindowsPasswordVerifier] auth failed for ${this.username}${result.stderr ? ": " + result.stderr.trim() : ""}`,
      );
    }
    return ok;
  }
}
