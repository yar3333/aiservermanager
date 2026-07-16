import { Component, signal, computed, inject, OnInit } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { firstValueFrom } from "rxjs";
import { ServiceService } from "../../services/service.service";
import { SelectedServiceService } from "../../services/selected-service.service";
import { ServiceAction, ServiceConfig, ServiceStatus } from "../../models/service";
import { ServiceDialogComponent, ServiceDialogData } from "./service-dialog/service-dialog.component";
import { ManagedServicesDialogComponent } from "./managed-services-dialog/managed-services-dialog.component";

/** Merged service status + optional config for custom services. */
export interface ServiceWithConfig {
  name: string;
  running: boolean;
  enabled: boolean;
  /** Whether the service unit is registered in the OS. */
  installed: boolean;
  pid?: number;
  error?: string;
  /** Config for custom services, null for managed. */
  config: ServiceConfig | null;
  /** True if this is a custom service (has config). */
  hasConfig: boolean;
}

@Component({
  selector: "app-services",
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatChipsModule],
  templateUrl: "./services.component.html",
  styleUrls: ["./services.component.scss"],
})
export class ServicesComponent implements OnInit {
  private serviceService = inject(ServiceService);
  private selectedServiceService = inject(SelectedServiceService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  readonly services = signal<ServiceStatus[]>([]);
  readonly configs = signal<ServiceConfig[]>([]);
  readonly loading = signal(true);

  /** Merged list: custom services + managed services with config. */
  readonly unified = computed<ServiceWithConfig[]>(() => {
    const svcList = this.services();
    const cfgList = this.configs();
    const cfgMap = new Map<string, ServiceConfig>();
    for (const c of cfgList) cfgMap.set(c.name, c);

    const customServices: ServiceWithConfig[] = svcList
      .filter((s) => cfgMap.has(s.name))
      .map((s) => {
        const config = cfgMap.get(s.name) ?? null;
        return {
          name: s.name,
          running: s.running,
          enabled: s.enabled,
          installed: s.installed,
          pid: s.pid,
          error: s.error,
          config,
          hasConfig: true,
        };
      });

    const managedServices: ServiceWithConfig[] = svcList
      .filter((s) => !cfgMap.has(s.name))
      .map((s): ServiceWithConfig => ({ ...s, config: null, hasConfig: false }));

    return [...customServices, ...managedServices];
  });

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
    this.selectedServiceService.select(name);
    try {
      const result = await firstValueFrom(this.serviceService.control(name, action));
      if (result.error) {
        this.showError(`${name}: ${result.error}`);
      }
      await this.load();
    } catch (err) {
      this.showError(`${name}: ${String((err as { error?: string }).error || err)}`);
    }
  }

  private showError(message: string): void {
    this.snackBar.open(message, "Dismiss", {
      duration: 8000,
      horizontalPosition: "center",
      verticalPosition: "top",
    });
  }

  manageServices(): void {
    const ref = this.dialog.open(ManagedServicesDialogComponent, { maxWidth: "600px" });
    ref.afterClosed().subscribe((result) => {
      if (result) {
        this.load();
      }
    });
  }

  addService(): void {
    this.openDialog(null);
  }

  editService(svc: ServiceWithConfig): void {
    this.selectedServiceService.select(svc.name);
    this.openDialog(svc.config);
  }

  async deleteService(name: string): Promise<void> {
    this.selectedServiceService.select(name);
    try {
      await firstValueFrom(this.serviceService.deleteConfig(name));
      await this.load();
    } catch (err) {
      this.showError(`Delete "${name}": ${String(err)}`);
    }
  }

  hasFlags(cfg: ServiceConfig): boolean {
    return Object.keys(cfg.flags).length > 0;
  }

  private openDialog(config: ServiceConfig | null): void {
    const data: ServiceDialogData = { config };
    const ref = this.dialog.open(ServiceDialogComponent, { data, maxWidth: "600px" });

    ref.afterClosed().subscribe(async (result: ServiceConfig | undefined) => {
      if (!result) return;

      const oldName = config?.name ?? null;
      const isNameChange = oldName !== null && oldName !== result.name;

      try {
        if (isNameChange) {
          // Capture old service state before destruction
          const oldService = this.unified().find((s) => s.name === oldName);
          const wasRunning = oldService?.running ?? false;

          // Delete old service (stops + uninstalls + removes config)
          await firstValueFrom(this.serviceService.deleteConfig(oldName!));

          // Create new service with new name
          await firstValueFrom(this.serviceService.saveConfig(result));

          // Restore running state
          if (wasRunning) {
            await firstValueFrom(this.serviceService.control(result.name, "start"));
          }
        } else {
          // Create or update (no name change)
          await firstValueFrom(this.serviceService.saveConfig(result));
        }

        await this.load();
      } catch (err) {
        this.showError(`Save: ${String(err)}`);
      }
    });
  }
}
