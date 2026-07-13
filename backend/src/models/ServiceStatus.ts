/** Per-service status reported by the backend. */
export interface ServiceStatus {
  name: string;
  running: boolean;
  enabled: boolean;
  /** Whether the service unit is registered in the OS (systemd / Windows Services). */
  installed: boolean;
  pid?: number;
  error?: string;
}

/** Action the client wants to perform on a service. */
export type ServiceAction = "start" | "stop" | "enable" | "disable";
