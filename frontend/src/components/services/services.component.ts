import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog } from "@angular/material/dialog";
import { ServiceService } from "../../services/service.service";
import { ServiceAction, ServiceConfig, ServiceStatus } from "../../models/service";
import { ServiceDialogComponent, ServiceDialogData } from "./service-dialog/service-dialog.component";

@Component({
  selector: "app-services",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatChipsModule],
  templateUrl: "./services.component.html",
  styleUrls: ["./services.component.scss"],
})
export class ServicesComponent {
  private serviceService = inject(ServiceService);
  private dialog = inject(MatDialog);

  services: ServiceStatus[] = [];
  configs: ServiceConfig[] = [];
  loading = true;

  constructor() {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.serviceService.fetchServices().subscribe({
      next: (services) => {
        this.services = services;
        this.loading = false;
      },
      error: (err) => {
        console.error("[ServicesComponent] fetch error:", err);
        this.loading = false;
      },
    });

    this.serviceService.fetchConfigs().subscribe({
      next: (configs) => {
        this.configs = configs;
      },
      error: (err) => {
        console.error("[ServicesComponent] fetch configs error:", err);
      },
    });
  }

  control(name: string, action: ServiceAction): void {
    this.serviceService.control(name, action).subscribe({
      next: () => this.load(),
      error: (err) => {
        console.error(`[ServicesComponent] control error (${name}/${action}):`, err);
      },
    });
  }

  addService(): void {
    this.openDialog(null);
  }

  editConfig(cfg: ServiceConfig): void {
    this.openDialog(cfg);
  }

  deleteConfig(suffix: string): void {
    this.serviceService.deleteConfig(suffix).subscribe({
      next: () => this.load(),
      error: (err) => {
        console.error(`[ServicesComponent] delete error (${suffix}):`, err);
      },
    });
  }

  hasFlags(cfg: ServiceConfig): boolean {
    return Object.keys(cfg.flags).length > 0;
  }

  private openDialog(config: ServiceConfig | null): void {
    const data: ServiceDialogData = { config };
    const ref = this.dialog.open(ServiceDialogComponent, { data, maxWidth: "600px" });

    ref.afterClosed().subscribe((result: ServiceConfig | undefined) => {
      if (result) {
        this.serviceService.saveConfig(result).subscribe({
          next: () => this.load(),
          error: (err) => {
            console.error("[ServicesComponent] save error:", err);
          },
        });
      }
    });
  }
}
