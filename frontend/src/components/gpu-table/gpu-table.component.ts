import { Component, input, output } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatTableModule } from "@angular/material/table";
import { MatCardModule } from "@angular/material/card";
import { MatChipsModule } from "@angular/material/chips";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { GpuWithUsage } from "../../models/gpu";

@Component({
  selector: "app-gpu-table",
  standalone: true,
  imports: [CommonModule, MatTableModule, MatCardModule, MatChipsModule, MatInputModule, MatFormFieldModule],
  templateUrl: "./gpu-table.component.html",
  styleUrls: ["./gpu-table.component.scss"],
})
export class GpuTableComponent {
  readonly gpus = input.required<GpuWithUsage[]>();

  /** Emitted when the user commits a new label value for a GPU. */
  readonly gpuLabelChange = output<{ pciBusId: string; gpuLabel: string }>();

  /** In-progress edits keyed by pciBusId — keeps typed text across table re-renders (usage polls). */
  private editValues = new Map<string, string>();

  displayedColumns: string[] = ["index", "name", "vram", "usage", "temperature", "pciBusId", "gpuLabel"];

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

  /** Visible text for the GPU label input (buffer takes priority over the model). */
  editValue(gpu: GpuWithUsage): string {
    return this.editValues.get(gpu.pciBusId) ?? gpu.gpuLabel;
  }

  onEditInput(gpu: GpuWithUsage, event: Event): void {
    this.editValues.set(gpu.pciBusId, (event.target as HTMLInputElement).value);
  }

  /** Commit on Enter or blur; skips when the value did not actually change. */
  commitEdit(gpu: GpuWithUsage): void {
    const raw = this.editValues.get(gpu.pciBusId);
    if (raw === undefined) return;
    this.editValues.delete(gpu.pciBusId);

    const value = raw.trim();
    if (value === gpu.gpuLabel.trim()) return;
    this.gpuLabelChange.emit({ pciBusId: gpu.pciBusId, gpuLabel: value });
  }

  makeGpuNameShort(name: string): string {
    name = name.replace(/^AMD Radeon RX /, "RX ");
    return name;
  }
}