import { ServiceAction, ServiceStatus } from "../models/ServiceStatus";

/** Platform-aware strategy for managing a named service. */
export interface ServiceController {
  /** Whether this controller can run on the current OS. */
  isAvailable(): Promise<boolean>;

  /** Query current status of a service by name. */
  getStatus(name: string): Promise<ServiceStatus>;

  /** Execute start / stop / enable / disable. */
  perform(name: string, action: ServiceAction): Promise<ServiceStatus>;

  /**
   * Install an aism-llama service from its config, then enable it (auto-start).
   * Returns the post-action status on success.
   */
  installAndEnable(name: string, execStart: string): Promise<ServiceStatus>;
}
