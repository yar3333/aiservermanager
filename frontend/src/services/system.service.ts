import { computed, Injectable, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { SystemInfoDetail } from "../models/gpu";

@Injectable({ providedIn: "root" })
export class SystemService {
  private http = inject(HttpClient);
  private readonly baseUrl = "/api/system";

  private _platform = signal<string | undefined>(undefined);
  /** OS of the backend as reported by /api/system/info; undefined until the first answer. */
  readonly platform = this._platform.asReadonly();
  /** Where a service account is logged on with a password and `Group=` does not exist. */
  readonly windows = computed(() => this._platform() === "win32");
  private platformQuery?: Promise<boolean>;

  async reboot(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.baseUrl}/reboot`, null));
  }

  async shutdown(): Promise<void> {
    await firstValueFrom(this.http.post(`${this.baseUrl}/shutdown`, null));
  }

  async getSystemInfo(): Promise<SystemInfoDetail> {
    return firstValueFrom(this.http.get<SystemInfoDetail>(`${this.baseUrl}/info`));
  }

  /**
   * Ask the backend which OS it runs on and publish the answer in `platform`/`windows`.
   * Components read those signals, so the question is asked once for the whole app.
   * A backend that does not answer is retried on the next call and read as Linux meanwhile.
   */
  detectWindows(): Promise<boolean> {
    this.platformQuery ??= this.getSystemInfo()
      .then((info) => {
        this._platform.set(info.server?.platform);
        return this.windows();
      })
      .catch(() => {
        this.platformQuery = undefined;
        return false;
      });
    return this.platformQuery;
  }
}
