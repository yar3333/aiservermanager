import * as os from "os";

/** Account whose password the dashboard accepts as the login credential. */
export interface AuthAccount {
  user: string;
  /** Omitted for a UPN (`name@domain`), where the domain rides with the name. */
  domain?: string;
}

export type AuthAccountResolution = { account: AuthAccount; source: "env" | "process" } | { error: string };

/**
 * Accounts a process can run as without having a password anyone could type:
 * the well-known service names, and a machine account (its name ends in "$"),
 * whose password only the domain controller knows.
 * Checked case-insensitively against the name the OS reports for the token.
 */
function isServiceAccountName(user: string): boolean {
  const name = user.trim().toLowerCase();
  return (
    name === "system" ||
    name === "localsystem" ||
    name === "local service" ||
    name === "network service" ||
    name.endsWith("$")
  );
}

/**
 * Split the configured account into the parts `LogonUser` wants, using the same
 * forms the service "run as" field documents: `NAME` is local, `HOST\NAME` and
 * `DOMAIN\NAME` are explicit, `NAME@domain` is a UPN and carries its own domain.
 */
export function parseAuthAccount(value: string, localMachine: string): { account?: AuthAccount; error?: string } {
  const configured = value.trim();
  if (!configured) return { error: "Account is empty." };

  if (configured.includes("@") && !configured.includes("\\")) {
    return { account: { user: configured } };
  }

  const separator = configured.indexOf("\\");
  if (separator === 0) {
    return { error: `"${configured}" has no domain before the backslash — write HOST\\NAME, NAME@domain, or just NAME.` };
  }
  if (separator > 0) {
    const domain = configured.slice(0, separator);
    const user = configured.slice(separator + 1);
    if (!user) return { error: `"${configured}" has no account name after the backslash.` };
    // "." means "this machine" in the service account field; LogonUser needs the name.
    return { account: { domain: domain === "." ? localMachine : domain, user } };
  }

  return { account: { user: configured, domain: localMachine } };
}

function processUserAccount(): AuthAccount | undefined {
  try {
    const user = os.userInfo().username;
    return user?.trim() ? { user: user.trim() } : undefined;
  } catch {
    // os.userInfo() fails when the account behind the token cannot be resolved.
    return undefined;
  }
}

/**
 * Whose password the dashboard checks.
 *
 * `AUTH_USER` wins. Without it the account falls back to the one running this
 * process, which is the right answer in the foreground (`npm start`, where the
 * user typing at the console owns the process) and the wrong one in a service:
 * the manager runs as root / LocalSystem because controlling other services is
 * the point, and neither has a password to type — LocalSystem has no password
 * at all and root's PAM entry is a different login than the operator's. So on
 * Windows a service-account fallback is refused with instructions instead of
 * being tried, which otherwise reads as "the correct password is wrong".
 */
export function resolveAuthAccount(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): AuthAccountResolution {
  const machine = env.COMPUTERNAME || os.hostname();
  const configured = env.AUTH_USER?.trim();

  if (configured) {
    const parsed = parseAuthAccount(configured, machine);
    if (parsed.error) return { error: `AUTH_USER: ${parsed.error}` };
    return { account: parsed.account!, source: "env" };
  }

  const processUser = processUserAccount();
  if (!processUser) {
    return {
      error:
        "No dashboard login account: this process cannot resolve its own user and AUTH_USER is not set. " +
        'Set AUTH_USER to the account whose password opens the dashboard (NAME, HOST\\NAME or NAME@domain).',
    };
  }

  if (platform === "win32" && isServiceAccountName(processUser.user)) {
    return {
      error:
        `No dashboard login account: this backend runs as "${processUser.user}", a service account with no ` +
        "password to type, and AUTH_USER is not set. Register the service with an account " +
        "(`aiservermanager install --auth-user <name>`) or set AUTH_USER in its environment, then restart it.",
    };
  }

  return { account: processUser, source: "process" };
}
