import { Component, signal, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatListModule } from "@angular/material/list";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { firstValueFrom } from "rxjs";
import { ServiceService } from "../../../services/service.service";

@Component({
  selector: "app-managed-services-dialog",
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatCheckboxModule,
    MatListModule,
    MatProgressBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: "./managed-services-dialog.component.html",
  styleUrls: ["./managed-services-dialog.component.scss"],
})
export class ManagedServicesDialogComponent implements OnInit {
  private serviceService = inject(ServiceService);
  private dialogRef = inject(MatDialogRef<ManagedServicesDialogComponent>);

  readonly available = signal<string[]>([]);
  readonly managed = signal<Set<string>>(new Set());
  readonly orphaned = signal<Set<string>>(new Set());
  readonly loading = signal(true);
  readonly filter = signal("");

  async ngOnInit(): Promise<void> {
    try {
      const [available, managed] = await Promise.all([
        firstValueFrom(this.serviceService.listAvailableServices()),
        firstValueFrom(this.serviceService.listManagedServices()),
      ]);
      this.available.set(available);
      this.managed.set(new Set(managed));
      const availableSet = new Set(available);
      const orphaned = managed.filter((name) => !availableSet.has(name));
      this.orphaned.set(new Set(orphaned));
    } catch (err) {
      console.error("[ManagedServicesDialog] load error:", err);
    } finally {
      this.loading.set(false);
    }
  }

  get filteredServices(): string[] {
    const available = this.available();
    const orphaned = this.orphaned();
    const all = [...new Set([...available, ...orphaned])].sort();
    const f = this.filter();
    if (!f) return all;
    const lower = f.toLowerCase();
    return all.filter((s) => s.toLowerCase().includes(lower));
  }

  isOrphaned(name: string): boolean {
    return this.orphaned().has(name);
  }

  isManaged(name: string): boolean {
    return this.managed().has(name);
  }

  async toggle(name: string): Promise<void> {
    try {
      if (this.isManaged(name)) {
        await firstValueFrom(this.serviceService.removeManagedService(name));
      } else {
        await firstValueFrom(this.serviceService.addManagedService(name));
      }
      const next = new Set(this.managed());
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      this.managed.set(next);
    } catch (err) {
      console.error(`[ManagedServicesDialog] toggle error (${name}):`, err);
    }
  }

  close(): void {
    this.dialogRef.close(true);
  }
}
