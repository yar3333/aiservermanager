/** Per-service status from the backend. */
export interface ServiceStatus {
  name: string;
  running: boolean;
  enabled: boolean;
  /** Whether the service unit is registered in the OS (systemd / Windows Services). */
  installed: boolean;
  pid?: number;
  error?: string;
}

/** Actions the client can perform. */
export type ServiceAction = "start" | "stop" | "enable" | "disable";

/** Service type: generic (arbitrary) or llama-server (structured config). */
export type ServiceType = "generic" | "llama-server";

/** Custom service config (full name + command + flags). */
export interface ServiceConfig {
  /** Full service name (e.g. "llama-server", "my-ai-worker") */
  name: string;
  /** Service type. Defaults to "generic" for backward compatibility. */
  type?: ServiceType;
  /** Absolute path to the executable */
  command: string;
  /** CLI arguments as raw strings */
  flags: string[];
}

/** A single journal log line from the backend. */
export interface JournalLine {
  timestamp: string;
  message: string;
}
