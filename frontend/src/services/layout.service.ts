import { Injectable, signal } from "@angular/core";

/** localStorage key for the persisted dashboard layout. */
const STORAGE_KEY = "dashboard-layout";

export type DashboardLayout = "vertical" | "horizontal";

/** Shared signal: current dashboard layout (vertical = journal on the right, horizontal = journal at the bottom). */
@Injectable({ providedIn: "root" })
export class LayoutService {
  readonly layout = signal<DashboardLayout>(this.readSaved());

  setLayout(layout: DashboardLayout): void {
    this.layout.set(layout);
    localStorage.setItem(STORAGE_KEY, layout);
  }

  private readSaved(): DashboardLayout {
    return localStorage.getItem(STORAGE_KEY) === "horizontal" ? "horizontal" : "vertical";
  }
}
