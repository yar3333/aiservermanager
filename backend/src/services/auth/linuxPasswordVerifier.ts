import * as os from "os";
import { injectable } from "inversify";
import { PasswordVerifier } from "./passwordVerifier";

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
  private readonly username = os.userInfo().username;

  async verify(password: string): Promise<boolean> {
    const pam: PamModule = require("authenticate-pam");

    if (!pam) {
      console.warn("[LinuxPasswordVerifier] PAM not available on this platform");
      return false;
    }
    return new Promise((resolve) => {
      pam.authenticate(
        this.username,
        password,
        (err: Error | null, _userInfo: unknown) => {
          if (err) {
            console.error(`[LinuxPasswordVerifier] PAM auth failed for ${this.username}: ${err.message}`);
            resolve(false);
            return;
          }
          console.log(`[LinuxPasswordVerifier] PAM auth successful for ${this.username}`);
          resolve(true);
        },
        { serviceName: "login" },
      );
    });
  }
}
