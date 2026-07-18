import { Component, computed, inject, signal, HostListener, OnInit, OnDestroy } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatToolbarModule } from "@angular/material/toolbar";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatCardModule } from "@angular/material/card";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { Gpu, GpuWithUsage, GpuUsage } from "../models/gpu";
import { GpuService } from "../services/gpu.service";
import { AuthService } from "../services/auth.service";
import { GpuTableComponent } from "../components/gpu-table/gpu-table.component";
import { ServicesComponent } from "../components/services/services.component";
import { JournalPanelComponent } from "../components/journal-panel/journal-panel.component";

const SPLITTER_MIN = 100;
const SPLITTER_MAX = 1600;

@Component({
  selector: "app-root",
  standalone: true,
  imports: [
    CommonModule,
    MatToolbarModule,
    MatProgressBarModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    GpuTableComponent,
    ServicesComponent,
    JournalPanelComponent,
  ],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent implements OnInit, OnDestroy {
  private gpuService = inject(GpuService);
  private authService = inject(AuthService);

  readonly gpus = signal<GpuWithUsage[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly hasGpus = computed(() => this.gpus().length > 0);

  // Auth state
  readonly isAuthenticated = signal(this.authService.isAuthenticated());
  readonly loginPassword = signal("");
  readonly loginError = signal<string | null>(null);

  // Draggable splitter state
  readonly sidebarWidth = signal<number>(420);
  readonly isDragging = signal<boolean>(false);
  private dragOffsetX = 0;
  private dragStartWidth = 420;

  ngOnInit(): void {
    // Listen for auth state changes (401 → logout)
    this.authService.authState.subscribe((authenticated) => {
      this.isAuthenticated.set(authenticated);
      if (authenticated) {
        this.loginError.set(null);
        this.loginPassword.set("");
      }
    });

    // Restore persisted width
    const saved = localStorage.getItem("journal-sidebar-width");
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (parsed >= SPLITTER_MIN && parsed <= SPLITTER_MAX) {
        this.sidebarWidth.set(parsed);
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

  startDrag(event: MouseEvent): void {
    event.preventDefault();
    this.dragOffsetX = event.clientX;
    this.dragStartWidth = this.sidebarWidth();
    this.isDragging.set(true);
  }

  @HostListener("document:mousemove", ["$event"])
  onDrag(event: MouseEvent): void {
    if (!this.isDragging()) return;
    const delta = this.dragOffsetX - event.clientX; // dragging left → positive
    let newWidth = this.dragStartWidth + delta;
    newWidth = Math.max(SPLITTER_MIN, Math.min(SPLITTER_MAX, newWidth));
    this.sidebarWidth.set(newWidth);
  }

  @HostListener("document:mouseup")
  onDragEnd(): void {
    if (this.isDragging()) {
      localStorage.setItem("journal-sidebar-width", String(this.sidebarWidth()));
      this.isDragging.set(false);
    }
  }

  constructor() {
    // If already authenticated (token in localStorage), initialize GPU data
    if (this.isAuthenticated()) {
      this.initGpus();
    }
  }

  private initGpus(): void {
    // 1. Fetch static GPU info once
    this.gpuService.fetchGpus().subscribe({
      next: (staticGpus) => {
        if (staticGpus.length === 0) {
          this.loading.set(false);
          return;
        }

        // Seed with zeroed usage until first poll arrives
        const seeded = staticGpus.map((g) => ({ ...g, key: g.pciBusId, usage: 0, temperature: 0, vramUsed: 0 }));
        this.gpus.set(seeded);
        this.loading.set(false);
        this.error.set(null);

        // 2. Start polling usage metrics
        this.gpuService.watchUsage().subscribe({
          next: (usages) => this.mergeUsage(staticGpus, usages),
          error: (err) => {
            console.error("[AppComponent] usage poll error:", err);
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

  private mergeUsage(staticGpus: Gpu[], usages: GpuUsage[]): void {
    const usageMap = new Map<string, GpuUsage>();
    for (const u of usages) {
      usageMap.set(u.key, u);
    }

    this.gpus.set(
      staticGpus.map((gpu) => {
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
