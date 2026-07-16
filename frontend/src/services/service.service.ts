import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { ServiceAction, ServiceConfig, ServiceStatus } from "../models/service";

@Injectable({ providedIn: "root" })
export class ServiceService {
  private http = inject(HttpClient);
  private readonly url = "/api/services";

  /** Fetch status of all managed services. */
  fetchServices(): Observable<ServiceStatus[]> {
    return this.http.get<ServiceStatus[]>(this.url);
  }

  /** Perform an action on a named service. */
  control(name: string, action: ServiceAction): Observable<ServiceStatus> {
    return this.http.post<ServiceStatus>(`${this.url}/control`, { name, action });
  }

  /** List all user-created service configs. */
  fetchConfigs(): Observable<ServiceConfig[]> {
    return this.http.get<ServiceConfig[]>(`${this.url}/config`);
  }

  /** Get a single service config by suffix. */
  getConfig(suffix: string): Observable<ServiceConfig> {
    return this.http.get<ServiceConfig>(`${this.url}/config/${suffix}`);
  }

  /** Create or update a service config. */
  saveConfig(cfg: ServiceConfig): Observable<ServiceConfig> {
    return this.http.post<ServiceConfig>(`${this.url}/config`, cfg);
  }

  /** Delete a service config and its systemd unit. */
  deleteConfig(suffix: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.url}/config/${suffix}`);
  }

  /** List all installed services on the system (excludes aism-llama-*). */
  listAvailableServices(): Observable<string[]> {
    return this.http.get<string[]>(`${this.url}/managed/available`);
  }

  /** List the user-selected managed service names. */
  listManagedServices(): Observable<string[]> {
    return this.http.get<string[]>(`${this.url}/managed`);
  }

  /** Add a service to the managed list. */
  addManagedService(name: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.url}/managed`, { name });
  }

  /** Remove a service from the managed list. */
  removeManagedService(name: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.url}/managed`, { body: { name } });
  }
}
