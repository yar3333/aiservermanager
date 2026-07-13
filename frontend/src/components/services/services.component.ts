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

const LLAMA_PREFIX = "aism-llama-";

/** Merged service status + optional config for aism-llama- services. */
export interface ServiceWithConfig {
  name: string;
  running: boolean;
  enabled: boolean;
  /** Whether the service unit is registered in the OS. */
  installed: boolean;
  pid?: number;
  error?: string;
  /** Config for aism-llama- services, null for built-in. */
  config: ServiceConfig | null;
  /** True if this is a user-created llama service. */
  isLlama: boolean;
  /** Suffix extracted from name (e.g. "qwen3" from "aism-llama-qwen3"). */
  suffix: string;
}

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

  /** Merged list: built-in services + user-created llama services with config. */
  readonly unified = computed<ServiceWithConfig[]>(() => {
    const svcList = this.services();
    const cfgList = this.configs();
    const cfgMap = new Map<string, ServiceConfig>();
    for (const c of cfgList) cfgMap.set(c.suffix, c);

    const llama: ServiceWithConfig[] = svcList
      .filter((s) => s.name.startsWith(LLAMA_PREFIX))
      .map((s) => {
        const suffix = s.name.slice(LLAMA_PREFIX.length);
        const config = cfgMap.get(suffix) ?? null;
        return {
          name: s.name,
          running: s.running,
          enabled: s.enabled,
          installed: s.installed,
          pid: s.pid,
          error: s.error,
          config,
          isLlama: true,
          suffix,
        };
      });

    const builtin: ServiceWithConfig[] = svcList
      .filter((s) => !s.name.startsWith(LLAMA_PREFIX))
      .map((s): ServiceWithConfig => ({ ...s, config: null, isLlama: false, suffix: "" }));

    return [...llama, ...builtin];
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
    try {
      await firstValueFrom(this.serviceService.control(name, action));
      await this.load();
    } catch (err) {
      console.error(`[ServicesComponent] control error (${name}/${action}):`, err);
    }
  }

  async installAndEnable(name: string): Promise<void> {
    try {
      await firstValueFrom(this.serviceService.installAndEnable(name));
      await this.load();
    } catch (err) {
      console.error(`[ServicesComponent] installAndEnable error (${name}):`, err);
    }
  }

  addService(): void {
    this.openDialog(null);
  }

  editService(svc: ServiceWithConfig): void {
    this.openDialog(svc.config);
  }

  async deleteService(suffix: string): Promise<void> {
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
