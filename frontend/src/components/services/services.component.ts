import { Component, signal, computed, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog } from "@angular/material/dialog";
import { firstValueFrom } from "rxjs";
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
export class ServicesComponent implements OnInit {
  private serviceService = inject(ServiceService);
  private dialog = inject(MatDialog);

  readonly services = signal<ServiceStatus[]>([]);
  readonly configs = signal<ServiceConfig[]>([]);
  readonly loading = signal(true);
  readonly hasConfigs = computed(() => this.configs().length > 0);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [services, configs] = await Promise.all([
        firstValueFrom(this.serviceService.fetchServices()),
        firstValueFrom(this.serviceService.fetchConfigs()),
      ]);
      this.services.set(services);
      this.configs.set(configs);
    } catch (err) {
      console.error("[ServicesComponent] load error:", err);
    } finally {
      this.loading.set(false);
    }
  }

  async control(name: string, action: ServiceAction): Promise<void> {
    try {
      await firstValueFrom(this.serviceService.control(name, action));
      await this.load();
    } catch (err) {
      console.error(`[ServicesComponent] control error (${name}/${action}):`, err);
    }
  }

  addService(): void {
    this.openDialog(null);
  }

  editConfig(cfg: ServiceConfig): void {
    this.openDialog(cfg);
  }

  async deleteConfig(suffix: string): Promise<void> {
    try {
      await firstValueFrom(this.serviceService.deleteConfig(suffix));
      await this.load();
    } catch (err) {
      console.error(`[ServicesComponent] delete error (${suffix}):`, err);
    }
  }

  hasFlags(cfg: ServiceConfig): boolean {
    return Object.keys(cfg.flags).length > 0;
  }

  private openDialog(config: ServiceConfig | null): void {
    const data: ServiceDialogData = { config };
    const ref = this.dialog.open(ServiceDialogComponent, { data, maxWidth: "600px" });

    ref.afterClosed().subscribe(async (result: ServiceConfig | undefined) => {
      if (result) {
        try {
          await firstValueFrom(this.serviceService.saveConfig(result));
          await this.load();
        } catch (err) {
          console.error("[ServicesComponent] save error:", err);
        }
      }
    });
  }
}
