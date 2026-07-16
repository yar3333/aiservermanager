import { Injectable, signal } from "@angular/core";

/** Shared signal: currently selected service name for the journal panel. */
@Injectable({ providedIn: "root" })
export class SelectedServiceService {
  readonly selectedService = signal<string | null>(null);

  select(name: string | null): void {
    this.selectedService.set(name);
  }
}
