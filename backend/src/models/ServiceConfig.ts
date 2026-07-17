/** Service config loaded from ~/.config/aiservermanager/services/<name>.conf */
export interface ServiceConfig {
  /** Full systemd service name (e.g. "llama-server", "my-ai-worker") */
  name: string;
  /** Absolute path to the executable (e.g. /home/yar/WinProg/llama-vulkan/llama-server) */
  command: string;
  /** CLI arguments as a list of raw strings (e.g. ["--model", "/path/to/model.gguf"]) */
  flags: string[];
}

/** Parse a config file into a ServiceConfig. First non-comment line with "command=" is the command; every other non-empty line is a raw CLI argument. */
export function parseConfigFile(name: string, raw: string): ServiceConfig {
  const flags: string[] = [];
  let command = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("command=")) {
      command = trimmed.slice("command=".length).trim();
    } else {
      flags.push(trimmed);
    }
  }

  return { name, command, flags };
}

/** Serialize a ServiceConfig back to a config file string. */
export function serializeConfig(cfg: ServiceConfig): string {
  const lines: string[] = [`command=${cfg.command}`];
  for (const flag of cfg.flags) {
    lines.push(flag);
  }
  return lines.join("\n") + "\n";
}

/** Build the full ExecStart command from a service config. */
export function buildExecStart(cfg: ServiceConfig): string {
  return cfg.flags.length ? `${cfg.command} ${cfg.flags.join(" ")}` : cfg.command;
}
