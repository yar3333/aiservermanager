import { Component, signal, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { SystemInfo } from "../../models/system";
import { SystemService } from "../../services/system.service";

@Component({
  selector: "app-system-bar",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatIconModule],
  templateUrl: "./system-bar.component.html",
  styleUrls: ["./system-bar.component.scss"],
})
export class SystemBarComponent implements OnInit {
  private systemService = inject(SystemService);

  readonly systemInfo = signal<SystemInfo>({
    cpuUsage: 0,
    memoryTotal: 0,
    memoryUsed: 0,
    memoryPercent: 0,
  });

  ngOnInit(): void {
    this.systemService.watchSystemInfo().subscribe({
      next: (info) => this.systemInfo.set(info),
      error: (err) => console.error("[SystemBarComponent] poll error:", err),
    });
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
