import { Component, signal, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatDividerModule } from "@angular/material/divider";
import { MatIconModule } from "@angular/material/icon";
import { SystemService } from "../../services/system.service";
import { SystemInfoDetail } from "../../models/gpu";

@Component({
  selector: "app-system-info-dialog",
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatProgressBarModule, MatDividerModule, MatIconModule],
  templateUrl: "./system-info-dialog.component.html",
  styleUrls: ["./system-info-dialog.component.scss"],
})
export class SystemInfoDialogComponent implements OnInit {
  private systemService = inject(SystemService);
  private dialogRef = inject(MatDialogRef<SystemInfoDialogComponent>);

  readonly loading = signal(true);
  readonly info = signal<SystemInfoDetail | null>(null);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const data = await this.systemService.getSystemInfo();
      this.info.set(data);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : "Failed to load system info");
    } finally {
      this.loading.set(false);
    }
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  }

  close(): void {
    this.dialogRef.close();
  }
}
