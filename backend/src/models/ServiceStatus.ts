/** Per-service status reported by the backend. */
export interface ServiceStatus {
  name: string;
  running: boolean;
  enabled: boolean;
  pid?: number;
  error?: string;
}

/** Action the client wants to perform on a service. */
export type ServiceAction = "start" | "stop" | "enable" | "disable";
