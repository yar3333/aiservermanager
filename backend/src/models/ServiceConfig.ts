/** Service type: generic (arbitrary) or llama-server (structured config). */
export type ServiceType = "generic" | "llama-server";

/** Valid environment variable name (POSIX / systemd rule). */
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Service config loaded from ~/.config/aiservermanager/services/<name>.conf */
export interface ServiceConfig {
  /** Full systemd service name (e.g. "llama-server", "my-ai-worker") */
  name: string;
  /** Service type. Defaults to "generic" for backward compatibility. */
  type?: ServiceType;
  /** Absolute path to the executable (e.g. /home/yar/WinProg/llama-vulkan/llama-server) */
  command: string;
  /** CLI arguments as a list of raw strings (e.g. ["--model", "/path/to/model.gguf"]) */
  flags: string[];
  /** Extra environment variables passed to the service process (KEY → value). */
  environment?: Record<string, string>;
}

/**
 * Parse a config file into a ServiceConfig. Lines with "type=", "command=" or
 * "env.KEY=" are metadata; every other non-empty line is a raw CLI argument.
 */
export function parseConfigFile(name: string, raw: string): ServiceConfig {
  const flags: string[] = [];
  const environment: Record<string, string> = {};
  let command = "";
  let type: ServiceType | undefined;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("type=")) {
      const val = trimmed.slice("type=".length).trim();
      if (val === "generic" || val === "llama-server") {
        type = val;
      }
    } else if (trimmed.startsWith("command=")) {
      command = trimmed.slice("command=".length).trim();
    } else if (trimmed.startsWith("env.")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice("env.".length, eqIdx).trim();
        if (ENV_KEY_REGEX.test(key)) {
          environment[key] = trimmed.slice(eqIdx + 1);
        }
      }
    } else {
      flags.push(trimmed);
    }
  }

  const envKeys = Object.keys(environment);
  return { name, type, command, flags, environment: envKeys.length ? environment : undefined };
}

/** Serialize a ServiceConfig back to a config file string. */
export function serializeConfig(cfg: ServiceConfig): string {
  const lines: string[] = [];
  if (cfg.type) {
    lines.push(`type=${cfg.type}`);
  }
  lines.push(`command=${cfg.command}`);
  if (cfg.environment) {
    for (const [key, value] of Object.entries(cfg.environment)) {
      if (ENV_KEY_REGEX.test(key) && !/[\r\n]/.test(value)) {
        lines.push(`env.${key}=${value}`);
      }
    }
  }
  for (const flag of cfg.flags) {
    lines.push(flag);
  }
  return lines.join("\n") + "\n";
}

/**
 * Build systemd `Environment=` unit lines for the given variables.
 * Values are double-quoted with backslash/quote escaping; `%` is doubled
 * because systemd expands % specifiers even inside Environment= values.
 */
export function buildEnvironmentLines(environment: Record<string, string>): string[] {
  return Object.entries(environment)
    .filter(([key]) => ENV_KEY_REGEX.test(key))
    .map(([key, value]) => {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
      return `Environment=${key}="${escaped}"`;
    });
}

/** Build the full ExecStart command from a service config. */
export function buildExecStart(cfg: ServiceConfig): string {
  return cfg.flags.length ? `${cfg.command} ${cfg.flags.join(" ")}` : cfg.command;
}
