import { Component, computed, inject, signal, HostListener, OnInit, OnDestroy } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatCardModule } from "@angular/material/card";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { Gpu, GpuWithUsage, GpuUsage, SystemInfo } from "../models/gpu";
import { GpuService } from "../services/gpu.service";
import { AuthService } from "../services/auth.service";
import { GpuTableComponent } from "../components/gpu-table/gpu-table.component";
import { ServicesComponent } from "../components/services/services.component";
import { JournalPanelComponent } from "../components/journal-panel/journal-panel.component";
import { SystemBarComponent } from "../components/system-bar/system-bar.component";

const JOURNAL_MIN = 160;
const JOURNAL_MAX = 800;
const JOURNAL_DEFAULT = 320;
const GPU_COL_MIN = 360;
const GPU_COL_MAX = 1400;
const GPU_COL_DEFAULT = 560;

type DragTarget = "journalHeight" | "gpuColWidth";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    MatProgressBarModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    GpuTableComponent,
    ServicesComponent,
    JournalPanelComponent,
    SystemBarComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit, OnDestroy {
  private gpuService = inject(GpuService);
  private authService = inject(AuthService);

  readonly gpus = signal<GpuWithUsage[]>([]);
  readonly systemInfo = signal<SystemInfo>({
    cpuUsage: 0,
    memoryTotal: 0,
    memoryUsed: 0,
    memoryPercent: 0,
  });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly hasGpus = computed(() => this.gpus().length > 0);

  // Auth state
  readonly isAuthenticated = signal(this.authService.isAuthenticated());
  readonly loginPassword = signal("");
  readonly loginError = signal<string | null>(null);

  // Draggable splitter state
  readonly journalHeight = signal<number>(JOURNAL_DEFAULT); // journal row height
  readonly gpuColWidth = signal<number>(GPU_COL_DEFAULT); // horizontal layout: GPU column width
  readonly isDragging = signal<boolean>(false);
  private dragTarget: DragTarget | null = null;
  private dragStartCoord = 0;
  private dragStartValue = 0;

  ngOnInit(): void {
    // Listen for auth state changes (401 → logout)
    this.authService.authState.subscribe((authenticated) => {
      this.isAuthenticated.set(authenticated);
      if (authenticated) {
        this.loginError.set(null);
        this.loginPassword.set("");
      }
    });

    // Restore persisted journal height
    const savedHeight = localStorage.getItem("journal-bottom-height");
    if (savedHeight) {
      const parsed = parseInt(savedHeight, 10);
      if (parsed >= JOURNAL_MIN && parsed <= JOURNAL_MAX) {
        this.journalHeight.set(parsed);
      }
    }

    // Restore persisted GPU column width
    const savedCol = localStorage.getItem("gpu-col-width");
    if (savedCol) {
      const parsed = parseInt(savedCol, 10);
      if (parsed >= GPU_COL_MIN && parsed <= GPU_COL_MAX) {
        this.gpuColWidth.set(parsed);
      }
    }
  }

  ngOnDestroy(): void {}

  async onLogin(): Promise<void> {
    this.loginError.set(null);
    const ok = await this.authService.login(this.loginPassword());
    if (!ok) {
      this.loginError.set("Invalid password");
    } else {
      this.loading.set(true);
      this.initGpus();
    }
  }

  // ── Splitter drag handlers ──

  startJournalHeightDrag(event: MouseEvent): void {
    this.beginDrag("journalHeight", event.clientY, this.journalHeight());
  }

  startGpuColDrag(event: MouseEvent): void {
    this.beginDrag("gpuColWidth", event.clientX, this.gpuColWidth());
  }

  private beginDrag(target: DragTarget, startCoord: number, startValue: number): void {
    this.dragTarget = target;
    this.dragStartCoord = startCoord;
    this.dragStartValue = startValue;
    this.isDragging.set(true);
  }

  @HostListener("document:mousemove", ["$event"])
  onDrag(event: MouseEvent): void {
    if (!this.isDragging() || !this.dragTarget) return;
    if (this.dragTarget === "journalHeight") {
      // Journal row at the bottom: dragging the handle up increases its height.
      const delta = this.dragStartCoord - event.clientY;
      this.journalHeight.set(this.clamp(this.dragStartValue + delta, JOURNAL_MIN, JOURNAL_MAX));
    } else if (this.dragTarget === "gpuColWidth") {
      // GPU column on the left: dragging the handle right widens it.
      const delta = event.clientX - this.dragStartCoord;
      this.gpuColWidth.set(this.clamp(this.dragStartValue + delta, GPU_COL_MIN, GPU_COL_MAX));
    }
  }

  @HostListener("document:mouseup")
  onDragEnd(): void {
    if (!this.isDragging() || !this.dragTarget) return;
    if (this.dragTarget === "journalHeight") {
      localStorage.setItem("journal-bottom-height", String(this.journalHeight()));
    } else if (this.dragTarget === "gpuColWidth") {
      localStorage.setItem("gpu-col-width", String(this.gpuColWidth()));
    }
    this.dragTarget = null;
    this.isDragging.set(false);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  constructor() {
    // If already authenticated (token in localStorage), initialize GPU data
    if (this.isAuthenticated()) {
      this.initGpus();
    }
  }

  private initGpus(retryCount = 0): void {
    // 1. Fetch static GPU info once
    this.gpuService.fetchGpus().subscribe({
      next: (staticGpus) => {
        if (staticGpus.length === 0) {
          // Retry up to 3 times with 5s delay if GPUs not detected yet
          if (retryCount < 3) {
            setTimeout(() => this.initGpus(retryCount + 1), 5000);
          } else {
            this.loading.set(false);
          }
          return;
        }

        // Seed with zeroed usage until first poll arrives
        const seeded = staticGpus.map((g) => ({ ...g, key: g.pciBusId, usage: 0, temperature: 0, vramUsed: 0 }));
        this.gpus.set(seeded);
        this.loading.set(false);
        this.error.set(null);

        // 2. Start polling unified status (GPU usage + system info)
        this.gpuService.watchStatus(3000).subscribe({
          next: (status) => {
            this.systemInfo.set(status.system);
            this.mergeUsage(status.gpus);
          },
          error: (err) => {
            console.error("[AppComponent] status poll error:", err);
          },
        });
      },
      error: (err) => {
        console.error("[AppComponent] static fetch error:", err);
        this.error.set(`Failed to fetch GPU data: ${err.message}`);
        this.loading.set(false);
      },
    });
  }

  /**
   * Overlay dynamic usage metrics onto the current GPU list, preserving
   * the bootstrap order (sorted by gpuIndex) and all static fields.
   */
  private mergeUsage(usages: GpuUsage[]): void {
    const usageMap = new Map<string, GpuUsage>();
    for (const u of usages) {
      usageMap.set(u.key, u);
    }

    this.gpus.update((current) =>
      current.map((gpu) => {
        const match = usageMap.get(gpu.pciBusId);
        return {
          ...gpu,
          key: gpu.pciBusId,
          usage: match?.usage ?? 0,
          temperature: match?.temperature ?? 0,
          vramUsed: match?.vramUsed ?? 0,
        };
      }),
    );
  }
}
