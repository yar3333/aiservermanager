import { Component, computed, input, inject, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { MatDividerModule } from "@angular/material/divider";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { SystemInfo } from "../../models/gpu";
import { SystemService } from "../../services/system.service";
import { HfService } from "../../services/hf.service";
import { LayoutService, DashboardLayout } from "../../services/layout.service";
import { SystemInfoDialogComponent } from "./system-info-dialog.component";
import { HfDownloadsDialogComponent } from "./hf-downloads-dialog.component";

@Component({
  selector: "app-system-bar",
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
    MatDialogModule,
  ],
  templateUrl: "./system-bar.component.html",
  styleUrls: ["./system-bar.component.scss"],
})
export class SystemBarComponent implements OnInit {
  readonly systemInfo = input.required<SystemInfo>();
  private systemService = inject(SystemService);
  private hfService = inject(HfService);
  private dialog = inject(MatDialog);
  private layoutService = inject(LayoutService);

  readonly layout = computed(() => this.layoutService.layout());
  readonly hfInstalled = signal(false);

  ngOnInit(): void {
    this.hfService
      .getStatus()
      .then((s) => this.hfInstalled.set(s.installed))
      .catch(() => this.hfInstalled.set(false));
  }

  setLayout(layout: DashboardLayout): void {
    this.layoutService.setLayout(layout);
  }

  openSystemInfo(): void {
    this.dialog.open(SystemInfoDialogComponent, { disableClose: false });
  }

  openHfDownloads(): void {
    this.dialog.open(HfDownloadsDialogComponent, { width: "760px", maxWidth: "95vw", disableClose: false });
  }

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
