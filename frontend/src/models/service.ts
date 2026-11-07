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

/** Service type: generic (arbitrary), llama-server, vllm or avalon (structured configs). */
export type ServiceType = "generic" | "llama-server" | "vllm" | "avalon";

/** Supported systemd Restart= values. */
export const SERVICE_RESTART_VALUES = [
  "no",
  "on-success",
  "on-failure",
  "on-abnormal",
  "on-watchdog",
  "on-abort",
  "always",
] as const;

export type ServiceRestart = (typeof SERVICE_RESTART_VALUES)[number];

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
  /** Extra environment variables passed to the service process (KEY → value). */
  environment?: Record<string, string>;
  /** Run the service as this user (systemd User= / Windows service account). Unset → root / LocalSystem. */
  user?: string;
  /** Run the service as this group (systemd Group=). Ignored on Windows. */
  group?: string;
  /**
   * Password of the Windows service account. Sent with the save request only:
   * the backend never stores it and never returns it, so re-registering a
   * service that runs as a user needs it typed again.
   */
  runAsPassword?: string;
  /** Command that stops the service (systemd ExecStop= / WinSW <stopexecutable>). */
  stopCommand?: string;
  /** Working directory of the service process (systemd WorkingDirectory= / WinSW <workingdirectory>). */
  workingDirectory?: string;
  /** Restart policy (systemd Restart=). Unset → "no" (systemd default). */
  restart?: ServiceRestart;
}

/** A single journal log line from the backend. */
export interface JournalLine {
  timestamp: string;
  message: string;
}
