import { Component, input, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { SystemInfo } from "../../models/gpu";
import { SystemService } from "../../services/system.service";

@Component({
  selector: "app-system-bar",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule, MatButtonModule],
  templateUrl: "./system-bar.component.html",
  styleUrls: ["./system-bar.component.scss"],
})
export class SystemBarComponent {
  readonly systemInfo = input.required<SystemInfo>();
  private systemService = inject(SystemService);

  async reboot(): Promise<void> {
    if (confirm("Reboot the server?")) {
      await this.systemService.reboot();
    }
  }

  async shutdown(): Promise<void> {
    if (confirm("Shutdown the server?")) {
      await this.systemService.shutdown();
    }
  }

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
