import * as path from "path";
import { ServiceRestart } from "../../models/ServiceConfig";

/** Everything WinSW needs to describe one wrapper service. */
export interface WinSwServiceSpec {
  /** Windows service name (SCM name) — also the WinSW config/exe base name. */
  id: string;
  /** Display name shown in services.msc. */
  displayName: string;
  /** Human-readable description. */
  description: string;
  /** Program from the service config — may be a .cmd/.bat wrapper. */
  executable: string;
  /** Raw CLI argument fragments, joined verbatim like systemd ExecStart does. */
  args: string[];
  /** Working directory of the launched process. */
  workingDirectory: string;
  /** Environment variables for the launched process. */
  environment?: Record<string, string>;
  /**
   * Account the service runs as. Without it the SCM runs the service as
   * LocalSystem, which sees a different %USERPROFILE% and none of the user's
   * credentials.
   */
  serviceAccount?: WinSwServiceAccount;
  /** Command that stops the service, written as <stopexecutable>/<stoparguments>. */
  stopCommand?: string;
  /** Restart policy from the service config (systemd Restart= vocabulary). */
  restart?: ServiceRestart;
  /** Directory for WinSW's own log files (`<logpath>`). */
  logDirectory: string;
}

/** WinSW `<serviceaccount>` content, split the way the Win32 logon API wants it. */
export interface WinSwServiceAccount {
  /** Domain, "." for the local machine, or absent for a UPN. */
  domain?: string;
  /** Account name, or name@domain when no domain is given. */
  user: string;
  /** Plain-text account password — WinSW hands it to the SCM at install time. */
  password: string;
}

const BATCH_EXT_REGEX = /\.(cmd|bat)$/i;

/** Whether the program must be launched through cmd.exe (batch script). */
export function isBatchFile(executable: string): boolean {
  return BATCH_EXT_REGEX.test(executable.trim());
}

/** Escape a value for use as XML text content. */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape a value for use inside a double-quoted XML attribute. */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/**
 * Map the systemd Restart= vocabulary onto WinSW's <onfailure>.
 * WinSW has no notion of exit codes here, so every "restart the service"
 * value collapses to the same failure action.
 */
export function buildOnFailureElement(restart?: ServiceRestart): string {
  if (!restart || restart === "no") {
    return `<onfailure action="none"/>`;
  }
  return `<onfailure action="restart" delay="10 sec"/>`;
}

/**
 * Build the `<executable>`/`<arguments>` pair.
 *
 * WinSW launches the program with UseShellExecute=false, which cannot run a
 * batch script directly, so .cmd/.bat files go through `cmd.exe /d /c`.
 */
export function buildExecutableElements(executable: string, args: string[]): string[] {
  const program = executable.trim();
  const argLine = args.join(" ").trim();

  if (!isBatchFile(program)) {
    const elements = [`<executable>${escapeXmlText(program)}</executable>`];
    if (argLine) elements.push(`<arguments>${escapeXmlText(argLine)}</arguments>`);
    return elements;
  }

  const elements = [
    "<executable>cmd.exe</executable>",
    `<arguments>/d /c "${escapeXmlText(program)}"${argLine ? ` ${escapeXmlText(argLine)}` : ""}</arguments>`,
    // Stopping cmd.exe first lets the console shut down its own child process.
    "<stopparentprocessfirst>true</stopparentprocessfirst>",
  ];
  return elements;
}

/** Build the `<env …/>` elements for the launched process. */
export function buildEnvElements(environment?: Record<string, string>): string[] {
  return Object.entries(environment ?? {})
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(
      ([key, value]) =>
        `<env name="${escapeXmlAttribute(key)}" value="${escapeXmlAttribute(value.replace(/[\r\n]+/g, " "))}"/>`,
    );
}

/**
 * Split the configured run-as account into the parts `<serviceaccount>` wants.
 *
 * A bare name becomes a local account (domain "."), so a mistyped or missing
 * domain fails loudly at install instead of resolving to an unexpected account.
 * A name@domain value (UPN) is passed through without a domain.
 */
export function parseServiceAccount(
  user?: string,
  password?: string,
): { account?: WinSwServiceAccount; error?: string } {
  const configured = user?.trim();
  if (!configured) return {};

  if (!password) {
    return {
      error:
        `Running a Windows service as "${configured}" requires its password: the Service ` +
        `Control Manager logs the account on with it. It is never stored — press Install ` +
        `(or save the service) and type it when asked, or clear the user to run as LocalSystem.`,
    };
  }

  if (configured.includes("@") && !configured.includes("\\")) {
    return { account: { user: configured, password } };
  }

  const separator = configured.indexOf("\\");
  if (separator > 0) {
    return {
      account: {
        domain: configured.slice(0, separator),
        user: configured.slice(separator + 1),
        password,
      },
    };
  }

  return { account: { domain: ".", user: configured, password } };
}

/** Identity for the LSA policy API, which — unlike `<serviceaccount>` — has no "." shorthand. */
export function logonRightIdentity(
  account: WinSwServiceAccount,
  localMachine: string,
): { domain?: string; user: string } {
  if (account.domain === ".") return { domain: localMachine, user: account.user };
  if (account.domain) return { domain: account.domain, user: account.user };
  return { user: account.user };
}

/** Build the `<serviceaccount>` block, or nothing when the service runs as LocalSystem. */
export function buildServiceAccountElements(account?: WinSwServiceAccount): string[] {
  if (!account) return [];

  const lines = ["<serviceaccount>"];
  if (account.domain) lines.push(`  <domain>${escapeXmlText(account.domain)}</domain>`);
  lines.push(`  <user>${escapeXmlText(account.user)}</user>`);
  // An empty password means "already handed to the SCM at install": the element
  // is left out so the file on disk keeps no trace of it.
  if (account.password) lines.push(`  <password>${escapeXmlText(account.password)}</password>`);
  lines.push("</serviceaccount>");
  return lines;
}

/** A quoted program followed by its arguments, e.g. `"C:\Program Files\x\kill.exe" /pid 1234`. */
const QUOTED_PROGRAM_REGEX = /^"([^"]+)"\s*(.*)$/;

/**
 * Build the `<stopexecutable>`/`<stoparguments>` pair for the configured stop
 * command.
 *
 * Two behaviours of WinSW 2.12 that a stop command has to live with, both
 * measured on the shipped binary: it appends the service's own `<arguments>` to
 * the stop command line, and it waits for the launched process to exit after
 * running it. There is no pid placeholder — `%d` reaches the process verbatim.
 */
export function buildStopElements(stopCommand?: string): string[] {
  const command = stopCommand?.trim();
  if (!command) return [];

  const quoted = QUOTED_PROGRAM_REGEX.exec(command);
  const program = quoted ? quoted[1] : command.split(/\s+/)[0];
  const args = (quoted ? quoted[2] : command.slice(program.length)).trim();

  const elements = [`<stopexecutable>${escapeXmlText(program)}</stopexecutable>`];
  if (args) elements.push(`<stoparguments>${escapeXmlText(args)}</stoparguments>`);
  return elements;
}

/**
 * How long a batch wrapper is given to stop before WinSW kills its process tree.
 * WinSW's own default is 15 seconds, and a `cmd.exe` running a script always
 * spends all of it: the Ctrl+C that asks the program to stop makes cmd print
 * "Terminate batch job (Y/N)?", which nothing can answer in a service, so the
 * wait only delays the kill that was coming anyway.
 */
export const BATCH_STOP_TIMEOUT = "5 sec";

/**
 * Shorten the stop wait for batch launchers. A configured stop command keeps
 * the full default window: it is the one case where the program may really be
 * shutting down behind it.
 */
export function buildStopTimeoutElement(executable?: string, stopCommand?: string): string[] {
  if (!executable || !isBatchFile(executable) || stopCommand?.trim()) return [];
  return [`<stoptimeout>${BATCH_STOP_TIMEOUT}</stoptimeout>`];
}

/**
 * Render the WinSW configuration for one wrapper service.
 *
 * `<startmode>` is pinned to Manual because install() must not autostart the
 * service; enable/disable is a separate action handled by `sc config`.
 */
export function buildWinSwXml(spec: WinSwServiceSpec): string {
  const lines = [
    "<service>",
    `  <id>${escapeXmlText(spec.id)}</id>`,
    `  <name>${escapeXmlText(spec.displayName)}</name>`,
    `  <description>${escapeXmlText(spec.description)}</description>`,
    ...buildServiceAccountElements(spec.serviceAccount).map((line) => `  ${line}`),
    ...buildExecutableElements(spec.executable, spec.args).map((line) => `  ${line}`),
    ...buildStopElements(spec.stopCommand).map((line) => `  ${line}`),
    ...buildStopTimeoutElement(spec.executable, spec.stopCommand).map((line) => `  ${line}`),
    `  <workingdirectory>${escapeXmlText(spec.workingDirectory)}</workingdirectory>`,
    "  <startmode>Manual</startmode>",
    `  ${buildOnFailureElement(spec.restart)}`,
    `  <logpath>${escapeXmlText(spec.logDirectory)}</logpath>`,
    '  <log mode="roll-by-size">',
    "    <sizeThreshold>10240</sizeThreshold>",
    "    <keepFiles>3</keepFiles>",
    "  </log>",
    ...buildEnvElements(spec.environment).map((line) => `  ${line}`),
    "</service>",
    "",
  ];
  return lines.join("\n");
}

/**
 * Working directory for a service: the configured one, or the directory that
 * holds the program — a batch script resolves its relative paths against it.
 */
export function resolveWorkingDirectory(configured: string | undefined, executable: string): string {
  const configuredTrimmed = configured?.trim();
  if (configuredTrimmed) return configuredTrimmed;

  // WinSW only ever runs on Windows, so the program path is read with Windows
  // rules even when this module runs elsewhere: to POSIX "C:\dir\run.cmd" holds
  // no separator at all and dirname() answers "." instead of the program folder.
  const dir = path.win32.dirname(executable.trim());
  return dir === "." ? process.cwd() : dir;
}
