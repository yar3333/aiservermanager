import { Component, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatToolbarModule } from "@angular/material/toolbar";
import { MatTableModule } from "@angular/material/table";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { Gpu, GpuWithUsage, GpuUsage } from "./models/gpu";
import { GpuService } from "./services/gpu.service";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, MatToolbarModule, MatTableModule, MatProgressBarModule, MatCardModule, MatChipsModule],
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.scss"],
})
export class AppComponent {
  private gpuService = inject(GpuService);

  displayedColumns: string[] = ["index", "name", "engineNames", "vram", "usage", "temperature", "pciBusId"];

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

  getVendorCssClass(gpu: GpuWithUsage) {
    return {
      "gpu-name": true,
      "gpu-vendor-nvidia": gpu.vendor === "NVIDIA",
      "gpu-vendor-amd": gpu.vendor === "AMD",
      "gpu-vendor-other": !["NVIDIA", "AMD"].includes(gpu.vendor),
    };
  }

  vramPercent(gpu: GpuWithUsage): number {
    if (gpu.vramTotal === 0) return 0;
    return Math.round((gpu.vramUsed / gpu.vramTotal) * 100);
  }

  colorForUsage(usage: number): string {
    if (usage < 40) return "#4caf50";
    if (usage < 75) return "#ff9800";
    return "#f44336";
  }

  colorForTemp(temp: number): string {
    if (temp < 60) return "#4caf50";
    if (temp < 80) return "#ff9800";
    return "#f44336";
  }

  getEngineNames(gpu: GpuWithUsage): string {
    const parts: string[] = [];
    if (gpu.engineCudaName) parts.push(gpu.engineCudaName);
    if (gpu.engineRocmName) parts.push(gpu.engineRocmName);
    if (gpu.engineVulkanName) parts.push(gpu.engineVulkanName);
    return parts.length > 0 ? parts.join(", ") : "—";
  }
}
