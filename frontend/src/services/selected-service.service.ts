import { Injectable, signal } from "@angular/core";

/** localStorage key for the persisted journal service selection. */
const STORAGE_KEY = "journal-selected-service";

/** Shared signal: currently selected service name for the journal panel. */
@Injectable({ providedIn: "root" })
export class SelectedServiceService {
  readonly selectedService = signal<string | null>(this.readSaved());

  select(name: string | null): void {
    this.selectedService.set(name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(name));
  }

  private readSaved(): string | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as string | null;
    } catch {
      return null;
    }
  }
}
