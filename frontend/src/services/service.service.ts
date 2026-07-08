import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import { ServiceAction, ServiceStatus } from "../models/service";

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
}
