import { Component, computed, signal, inject, OnInit, OnDestroy } from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatIconModule } from "@angular/material/icon";
import { HfService } from "../../services/hf.service";
import { HfDownload, HfLocalModel, HfOrphanBlob } from "../../models/hf";

const POLL_MS = 2000;

@Component({
  selector: "app-llm-models-dialog",
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatProgressBarModule, MatIconModule],
  templateUrl: "./llm-models-dialog.component.html",
  styleUrls: ["./llm-models-dialog.component.scss"],
})
export class LlmModelsDialogComponent implements OnInit, OnDestroy {
  private hfService = inject(HfService);
  private dialogRef = inject(MatDialogRef<LlmModelsDialogComponent>);

  /** In-progress `hf download` groups — polled every POLL_MS. */
  readonly downloads = signal<HfDownload[]>([]);
  /** Models already in the local Hugging Face cache — loaded once + after delete (sizes are expensive). */
  readonly models = signal<HfLocalModel[]>([]);
  readonly loading = signal(true);
  readonly modelsLoading = signal(true);
  readonly error = signal<string | null>(null);
  /** Model whose delete is in flight (disables its button). */
  readonly deleting = signal<string | null>(null);

  /** Models currently being downloaded are shown as cards, not in the static list. */
  readonly staticModels = computed(() => {
    const active = new Set(this.downloads().map((d) => d.dest));
    return this.models().filter((m) => !active.has(m.dir));
  });

  /** Unreferenced blob files in the shared hub/blobs (older than 24h). */
  readonly orphans = signal<HfOrphanBlob[]>([]);
  readonly orphansLoading = signal(true);
  /** Cleanup of orphans in flight. */
  readonly cleaning = signal(false);

  readonly totalOrphanBytes = computed(() => this.orphans().reduce((sum, o) => sum + o.size, 0));

  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  ngOnInit(): void {
    void this.refresh();
    void this.refreshModels();
    void this.refreshOrphans();
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
      this.error.set(this.errorText(err, "Failed to load downloads"));
    } finally {
      this.loading.set(false);
    }
  }

  async refreshModels(): Promise<void> {
    try {
      this.models.set(await this.hfService.getLocalModels());
    } catch (err: unknown) {
      this.error.set(this.errorText(err, "Failed to load models"));
    } finally {
      this.modelsLoading.set(false);
    }
  }

  async refreshOrphans(): Promise<void> {
    try {
      this.orphans.set(await this.hfService.getOrphanBlobs());
    } catch (err: unknown) {
      this.error.set(this.errorText(err, "Failed to load orphaned blobs"));
    } finally {
      this.orphansLoading.set(false);
    }
  }

  /** Extract a human-readable message — the backend sends { error: string } on failures. */
  private errorText(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { error?: string } | null;
      return body?.error ?? err.message;
    }
    return err instanceof Error ? err.message : fallback;
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

  async deleteModel(m: HfLocalModel): Promise<void> {
    if (this.deleting()) return;
    if (!confirm(`Delete model ${m.name} (${this.formatBytes(m.size)}) from the Hugging Face cache?`)) return;
    this.deleting.set(m.name);
    try {
      await this.hfService.deleteLocalModel(m.name);
      await this.refreshModels();
      await this.refreshOrphans();
    } catch (err: unknown) {
      this.error.set(this.errorText(err, `Failed to delete ${m.name}`));
    } finally {
      this.deleting.set(null);
    }
  }

  async cleanupOrphans(): Promise<void> {
    if (this.cleaning()) return;
    const n = this.orphans().length;
    if (!confirm(`Delete ${n} orphaned blob file(s) (${this.formatBytes(this.totalOrphanBytes())})?`)) return;
    this.cleaning.set(true);
    try {
      await this.hfService.cleanupOrphanBlobs();
      await this.refreshOrphans();
    } catch (err: unknown) {
      this.error.set(this.errorText(err, "Failed to clean up orphaned blobs"));
    } finally {
      this.cleaning.set(false);
    }
  }

  private async act(action: "pause" | "resume" | "cancel", d: HfDownload): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.hfService.action(action, d);
      await this.refresh();
    } catch (err: unknown) {
      this.error.set(this.errorText(err, `Failed to ${action} download`));
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
