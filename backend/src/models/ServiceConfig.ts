/** Service config loaded from ~/.config/aiservermanager/services/<name>.conf */
export interface ServiceConfig {
  /** Full systemd service name (e.g. "llama-server", "my-ai-worker") */
  name: string;
  /** Absolute path to the executable (e.g. /home/yar/WinProg/llama-vulkan/llama-server) */
  command: string;
  /** CLI flags as key→value pairs (e.g. { "--model": "/path/to/model.gguf" }) */
  flags: Record<string, string>;
}

/** Parse a flat key=value config file into a ServiceConfig. */
export function parseConfigFile(name: string, raw: string): ServiceConfig {
  const flags: Record<string, string> = {};
  let command = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key === "command") {
      command = value;
    } else {
      flags[key] = value;
    }
  }

  return { name, command, flags };
}

/** Serialize a ServiceConfig back to a flat key=value string. */
export function serializeConfig(cfg: ServiceConfig): string {
  const lines: string[] = [`command=${cfg.command}`];
  for (const [key, value] of Object.entries(cfg.flags)) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n") + "\n";
}

/** Build the full ExecStart command from a service config. */
export function buildExecStart(cfg: ServiceConfig): string {
  const args = Object.entries(cfg.flags)
    .map(([key, value]) => {
      if (value.includes(" ")) {
        return `${key}='${value}'`;
      }
      return `${key}=${value}`;
    })
    .join(" ");

  return args ? `${cfg.command} ${args}` : cfg.command;
}
