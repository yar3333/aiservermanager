import { Component, signal, inject, OnInit, WritableSignal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar } from "@angular/material/snack-bar";
import { firstValueFrom } from "rxjs";
import { ServiceService } from "../../../services/service.service";
import { ServiceConfig } from "../../../models/service";

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
  /** Name currently being moved — disables all move buttons while in flight. */
  readonly busy = signal<string | null>(null);

  /** Becomes true after any successful move, so the caller reloads on close. */
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
      await firstValueFrom(this.serviceService.archiveService(name));
      this.move(name, this.active, this.archived);
      this.dirty = true;
    } catch (err) {
      this.showError(`Archive "${name}": ${String(err)}`);
    } finally {
      this.busy.set(null);
    }
  }

  /** Move a service back out of the archive (moves config, reinstalls the unit). */
  async restore(name: string): Promise<void> {
    this.busy.set(name);
    try {
      await firstValueFrom(this.serviceService.restoreService(name));
      this.move(name, this.archived, this.active);
      this.dirty = true;
    } catch (err) {
      this.showError(`Restore "${name}": ${String(err)}`);
    } finally {
      this.busy.set(null);
    }
  }

  private move(name: string, from: WritableSignal<ServiceConfig[]>, to: WritableSignal<ServiceConfig[]>): void {
    const item = from().find((c) => c.name === name);
    if (!item) return;
    from.set(from().filter((c) => c.name !== name));
    to.set([...to(), item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  private showError(message: string): void {
    this.snackBar.open(message, "Dismiss", {
      duration: 6000,
      horizontalPosition: "center",
      verticalPosition: "top",
    });
  }

  close(): void {
    this.dialogRef.close(this.dirty);
  }
}
