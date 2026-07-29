import { Component, input } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { SystemInfo } from "../../models/gpu";

@Component({
  selector: "app-system-bar",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule],
  templateUrl: "./system-bar.component.html",
  styleUrls: ["./system-bar.component.scss"],
})
export class SystemBarComponent {
  readonly systemInfo = input.required<SystemInfo>();

  formatBytes(bytes: number): string {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${Math.ceil(gb)} GB`;
  }

  ceilCpu(usage: number): number {
    return Math.ceil(usage);
  }

  colorForUsage(usage: number): string {
    if (usage < 40) return "#4caf50";
    if (usage < 75) return "#ff9800";
    return "#f44336";
  }
}
