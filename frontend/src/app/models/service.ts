/** Per-service status from the backend. */
export interface ServiceStatus {
  name: string;
  running: boolean;
  enabled: boolean;
  pid?: number;
  error?: string;
}

/** Actions the client can perform. */
export type ServiceAction = "start" | "stop" | "enable" | "disable";
