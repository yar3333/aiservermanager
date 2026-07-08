import { Component, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { MatCardModule } from "@angular/material/card";
import { MatButtonModule } from "@angular/material/button";
import { MatChipsModule } from "@angular/material/chips";
import { ServiceService } from "../../services/service.service";
import { ServiceAction, ServiceStatus } from "../../models/service";

@Component({
  selector: "app-services",
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatChipsModule],
  templateUrl: "./services.component.html",
  styleUrls: ["./services.component.scss"],
})
export class ServicesComponent {
  private serviceService = inject(ServiceService);

  readonly services = signal<ServiceStatus[]>([]);
  readonly loading = signal(true);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.serviceService.fetchServices().subscribe({
      next: (services) => {
        this.services.set(services);
        this.loading.set(false);
      },
      error: (err) => {
        console.error("[ServicesComponent] fetch error:", err);
        this.loading.set(false);
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
}
