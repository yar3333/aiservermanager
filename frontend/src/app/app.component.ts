import { Component, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatToolbarModule } from "@angular/material/toolbar";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatCardModule } from "@angular/material/card";
import { Gpu, GpuWithUsage, GpuUsage } from "./models/gpu";
import { GpuService } from "./services/gpu.service";
import { GpuTableComponent } from "./components/gpu-table/gpu-table.component";
import { ServicesComponent } from "./components/services/services.component";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatProgressBarModule, MatCardModule, GpuTableComponent, ServicesComponent],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent {
  private gpuService = inject(GpuService);

  readonly gpus = signal<GpuWithUsage[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly hasGpus = computed(() => this.gpus().length > 0);

  constructor() {
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
