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

/** User-created service config (llama.cpp server). */
export interface ServiceConfig {
  /** Suffix used in service name: aism-llama-{suffix}.service */
  suffix: string;
  /** Absolute path to the executable */
  command: string;
  /** CLI flags as key→value pairs */
  flags: Record<string, string>;
}
