/**
 * Outcome of a password check.
 *
 * A wrong password and a broken verifier must not be conflated: the first feeds
 * the brute-force lockout, the second would lock the operator out of their own
 * dashboard while nothing was actually guessed.
 */
export type VerifyOutcome =
  | { status: "ok" }
  | { status: "denied"; detail?: string }
  | { status: "error"; message: string };

/**
 * Platform-specific strategy for verifying a user password against the OS auth store.
 */
export interface PasswordVerifier {
  /**
   * Verify the given password for the dashboard account (`AUTH_USER`, else the
   * account running this process — see `resolveAuthAccount`).
   */
  verify(password: string): Promise<VerifyOutcome>;
}
