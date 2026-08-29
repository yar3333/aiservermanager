import { Injectable, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { ServiceService } from "./service.service";
import { ServiceStatus } from "../models/service";

/**
 * Shared store of managed service statuses.
 *
 * Refreshed by every component that mutates services (create/edit/delete/manage),
 * so consumers — like the journal dropdown — always see the current list without a page reload.
 */
@Injectable({ providedIn: "root" })
export class ServiceListService {
  private serviceService = inject(ServiceService);

  readonly services = signal<ServiceStatus[]>([]);
  /** True after the first successful fetch. */
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  /** Fetch fresh service statuses and publish them to the shared signal. Never throws. */
  async refresh(): Promise<void> {
    try {
      const services = await firstValueFrom(this.serviceService.fetchServices());
      this.services.set(services);
      this.error.set(null);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
      console.error("[ServiceListService] refresh error:", err);
    }
  }
}
