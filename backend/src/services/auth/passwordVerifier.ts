/**
 * Platform-specific strategy for verifying a user password against the OS auth store.
 */
export interface PasswordVerifier {
  /**
   * Verify the given password for the current process user.
   *
   * @returns true if the password matches the OS credential store.
   */
  verify(password: string): Promise<boolean>;
}
