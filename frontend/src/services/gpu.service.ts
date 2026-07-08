import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, timer } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import { Gpu, GpuUsage } from "../models/gpu";

@Injectable({ providedIn: "root" })
export class GpuService {
  private http = inject(HttpClient);
  private readonly staticUrl = "/api/gpus";
  private readonly usageUrl = "/api/gpus/usage";

  /** Fetch static GPU info (called once on init). */
  fetchGpus(): Observable<Gpu[]> {
    return this.http.get<Gpu[]>(this.staticUrl).pipe(
      tap({
        error: (err) => console.error("[GpuService] static fetch error:", err),
      }),
    );
  }

  /** Fetch dynamic usage metrics. */
  fetchUsage(): Observable<GpuUsage[]> {
    return this.http.get<GpuUsage[]>(this.usageUrl).pipe(
      tap({
        error: (err) => console.error("[GpuService] usage fetch error:", err),
      }),
    );
  }

  /** Poll GPU usage every N ms, starting immediately. */
  watchUsage(intervalMs = 3000): Observable<GpuUsage[]> {
    return timer(0, intervalMs).pipe(switchMap(() => this.fetchUsage()));
  }
}
