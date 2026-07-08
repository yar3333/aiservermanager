import { Component, input } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatTableModule } from "@angular/material/table";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { GpuWithUsage } from "../../models/gpu";

@Component({
  selector: "app-gpu-table",
  standalone: true,
  imports: [CommonModule, MatTableModule, MatCardModule, MatChipsModule],
  templateUrl: "./gpu-table.component.html",
  styleUrls: ["./gpu-table.component.scss"],
})
export class GpuTableComponent {
  readonly gpus = input.required<GpuWithUsage[]>();

  displayedColumns: string[] = ["index", "name", "engineNames", "vram", "usage", "temperature", "pciBusId"];

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
