import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { SystemInfoDetail } from "../models/gpu";

@Injectable({ providedIn: "root" })
export class SystemService {
  private http = inject(HttpClient);
  private readonly baseUrl = "/api/system";

  async reboot(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.baseUrl}/reboot`, null));
  }

  async shutdown(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.baseUrl}/shutdown`, null));
  }

  async getSystemInfo(): Promise<SystemInfoDetail> {
    return firstValueFrom(this.http.get<SystemInfoDetail>(`${this.baseUrl}/info`));
  }
}
