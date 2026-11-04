import { Component, signal, computed, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar } from "@angular/material/snack-bar";
import { firstValueFrom } from "rxjs";
import { ServiceService } from "../../../services/service.service";
import { ServiceConfig } from "../../../models/service";

/** A row in the combined list: a conf service with its archive state. */
export interface ArchiveEntry {
  name: string;
  archived: boolean;
}

@Component({
  selector: "app-archive-dialog",
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatProgressBarModule, MatIconModule],
  templateUrl: "./archive-dialog.component.html",
  styleUrls: ["./archive-dialog.component.scss"],
})
export class ArchiveDialogComponent implements OnInit {
  private serviceService = inject(ServiceService);
  private dialogRef = inject(MatDialogRef<ArchiveDialogComponent>);
  private snackBar = inject(MatSnackBar);

  readonly active = signal<ServiceConfig[]>([]);
  readonly archived = signal<ServiceConfig[]>([]);
  readonly loading = signal(true);
  /** Name currently being moved — disables all action buttons while in flight. */
  readonly busy = signal<string | null>(null);

  /** Quick filter by service name (case-insensitive substring). */
  readonly filter = signal("");

  /** All conf services (active + archived) in one list, sorted by name. */
  readonly entries = computed<ArchiveEntry[]>(() => [
    ...this.active().map((c) => ({ name: c.name, archived: false })),
    ...this.archived().map((c) => ({ name: c.name, archived: true })),
  ].sort((a, b) => a.name.localeCompare(b.name)));

  readonly filtered = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = this.entries();
    return q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
  });

  onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
  }

  /** Becomes true after any successful change, so the caller reloads on close. */
  private dirty = false;

  async ngOnInit(): Promise<void> {
    try {
      const [active, archived] = await Promise.all([
        firstValueFrom(this.serviceService.fetchConfigs()),
        firstValueFrom(this.serviceService.fetchArchivedConfigs()),
      ]);
      this.active.set(active);
      this.archived.set(archived);
    } catch (err) {
      console.error("[ArchiveDialog] load error:", err);
    } finally {
      this.loading.set(false);
    }
  }

  /** Move a service into the archive (stops + uninstalls it, shelves its config). */
  async archive(name: string): Promise<void> {
    this.busy.set(name);
    try {
      const item = this.active().find((c) => c.name === name);
      await firstValueFrom(this.serviceService.archiveService(name));
      if (item) {
        this.active.set(this.active().filter((c) => c.name !== name));
        this.archived.set([...this.archived(), item]);
      }
      this.dirty = true;
    } catch (err) {
      this.showError(`Archive "${name}": ${this.errorText(err)}`);
    } finally {
      this.busy.set(null);
    }
  }

  /** Move a service back out of the archive (moves config, reinstalls the unit). */
  async restore(name: string): Promise<void> {
    this.busy.set(name);
    try {
      const item = this.archived().find((c) => c.name === name);
      await firstValueFrom(this.serviceService.restoreService(name));
      if (item) {
        this.archived.set(this.archived().filter((c) => c.name !== name));
        this.active.set([...this.active(), item]);
      }
      this.dirty = true;
    } catch (err) {
      this.showError(`Restore "${name}": ${this.errorText(err)}`);
    } finally {
      this.busy.set(null);
    }
  }

  /** Delete a conf service (active or archived) after confirmation. Archived services have no unit. */
  async remove(name: string, archived: boolean): Promise<void> {
    const message = archived
      ? `Delete archived service "${name}"? Its config will be permanently removed.`
      : `Delete service "${name}"? Its systemd unit will be uninstalled and its config permanently removed.`;
    if (!confirm(message)) return;
    this.busy.set(name);
    try {
      await firstValueFrom(this.serviceService.deleteConfig(name));
      this.active.set(this.active().filter((c) => c.name !== name));
      this.archived.set(this.archived().filter((c) => c.name !== name));
      this.dirty = true;
    } catch (err) {
      this.showError(`Delete "${name}": ${this.errorText(err)}`);
    } finally {
      this.busy.set(null);
    }
  }

  private showError(message: string): void {
    this.snackBar.open(message, "Dismiss", {
      duration: 6000,
      horizontalPosition: "center",
      verticalPosition: "top",
    });
  }

  /** Extract a human-readable message — the backend sends { error: string } on failures. */
  private errorText(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { error?: string } | null;
      return body?.error ?? err.message;
    }
    return String(err);
  }

  close(): void {
    this.dialogRef.close(this.dirty);
  }
}
