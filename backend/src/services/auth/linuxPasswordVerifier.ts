import { injectable } from "inversify";
import { resolveAuthAccount } from "./authAccount";
import { PasswordVerifier, VerifyOutcome } from "./passwordVerifier";

interface PamModule {
  authenticate(
    username: string,
    password: string,
    callback: (err: Error | null, userInfo: unknown) => void,
    options?: { serviceName?: string },
  ): void;
}

/**
 * Verify password through PAM using the 'login' service.
 * Uses the same authentication stack as system login.
 */
@injectable()
export class LinuxPasswordVerifier implements PasswordVerifier {
  async verify(password: string): Promise<VerifyOutcome> {
    const resolved = resolveAuthAccount();
    if ("error" in resolved) {
      console.error(`[LinuxPasswordVerifier] ${resolved.error}`);
      return { status: "error", message: resolved.error };
    }

    const { account } = resolved;

    let pam: PamModule | undefined;
    try {
      // The addon is an optionalDependency and is not built on every platform.
      pam = require("authenticate-pam");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[LinuxPasswordVerifier] PAM addon unavailable: ${message}`);
      return {
        status: "error",
        message: "PAM is not available on this backend (the authenticate-pam addon is not installed).",
      };
    }

    if (!pam) {
      console.warn("[LinuxPasswordVerifier] PAM not available on this platform");
      return { status: "error", message: "PAM is not available on this backend." };
    }

    return new Promise((resolve) => {
      pam!.authenticate(
        account.user,
        password,
        (err: Error | null, _userInfo: unknown) => {
          if (err) {
            console.error(`[LinuxPasswordVerifier] PAM auth failed for ${account.user}: ${err.message}`);
            resolve({ status: "denied", detail: err.message });
            return;
          }
          console.log(`[LinuxPasswordVerifier] PAM auth successful for ${account.user}`);
          resolve({ status: "ok" });
        },
        { serviceName: "login" },
      );
    });
  }
}
