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

/** Deep-managed service config (full name + command + flags). */
export interface ServiceConfig {
  /** Full service name (e.g. "llama-server", "my-ai-worker") */
  name: string;
  /** Absolute path to the executable */
  command: string;
  /** CLI flags as key→value pairs */
  flags: Record<string, string>;
}
