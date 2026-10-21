import { Component, signal, inject, OnInit, OnDestroy } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatIconModule } from "@angular/material/icon";
import { HfService } from "../../services/hf.service";
import { HfDownload } from "../../models/hf";

const POLL_MS = 2000;

@Component({
  selector: "app-hf-downloads-dialog",
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatProgressBarModule, MatIconModule],
  templateUrl: "./hf-downloads-dialog.component.html",
  styleUrls: ["./hf-downloads-dialog.component.scss"],
})
export class HfDownloadsDialogComponent implements OnInit, OnDestroy {
  private hfService = inject(HfService);
  private dialogRef = inject(MatDialogRef<HfDownloadsDialogComponent>);

  readonly downloads = signal<HfDownload[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      this.downloads.set(await this.hfService.getDownloads());
      this.error.set(null);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : "Failed to load HF downloads");
    } finally {
      this.loading.set(false);
    }
  }

  async pause(d: HfDownload): Promise<void> {
    await this.act("pause", d);
  }

  async resume(d: HfDownload): Promise<void> {
    await this.act("resume", d);
  }

  async cancel(d: HfDownload): Promise<void> {
    if (confirm(`Cancel download of ${d.repoId}? Partial files will be kept for resume.`)) {
      await this.act("cancel", d);
    }
  }

  private async act(action: "pause" | "resume" | "cancel", d: HfDownload): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.hfService.action(action, d);
      await this.refresh();
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : `Failed to ${action} download`);
    } finally {
      this.busy = false;
    }
  }

  percent(d: HfDownload): number | null {
    if (d.totalBytes <= 0) return null;
    return Math.min(100, (d.doneBytes / d.totalBytes) * 100);
  }

  progressMode(d: HfDownload): "determinate" | "indeterminate" {
    return d.totalBytes > 0 ? "determinate" : "indeterminate";
  }

  formatBytes(bytes: number): string {
    if (bytes <= 0) return "0 B";
    const gb = bytes / (1024 ** 3);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 ** 2);
    return `${mb.toFixed(0)} MB`;
  }

  formatSpeed(bps: number): string {
    if (bps <= 0) return "—";
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  formatEta(seconds: number | null): string {
    if (seconds === null) return "—";
    if (seconds < 60) return `${seconds} s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h} h ${m} m` : `${m} m`;
  }

  close(): void {
    this.dialogRef.close();
  }
}
