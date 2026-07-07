import { Component, computed, effect, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatToolbarModule } from "@angular/material/toolbar";
import { MatTableModule } from "@angular/material/table";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { Gpu } from "./models/gpu";
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

  readonly gpus = signal<Gpu[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly hasGpus = computed(() => this.gpus().length > 0);

  constructor() {
    //this.gpuService.watchGpus().subscribe({
    this.gpuService.fetchGpus().subscribe({
      next: (data) => {
        this.gpus.set(data);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (err) => {
        console.error("GPU fetch error:", err);
        this.error.set(`Failed to fetch GPU data: ${err.message}`);
        this.loading.set(false);
      },
    });
  }

  getVendorCssClass(gpu: Gpu) {
    return {
      "gpu-name": true,
      "gpu-vendor-nvidia": gpu.vendor === "NVIDIA",
      "gpu-vendor-amd": gpu.vendor === "AMD",
      "gpu-vendor-other": !["NVIDIA", "AMD"].includes(gpu.vendor),
    };
  }

  vramPercent(gpu: Gpu): number {
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

  getEngineNames(gpu: Gpu): string {
    const parts: string[] = [];
    if (gpu.engineCudaName) parts.push(gpu.engineCudaName);
    if (gpu.engineRocmName) parts.push(gpu.engineRocmName);
    if (gpu.engineVulkanName) parts.push(gpu.engineVulkanName);
    return parts.length > 0 ? parts.join(", ") : "—";
  }
}
