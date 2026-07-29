import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, timer } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import { Gpu, GpuStatusResponse } from "../models/gpu";

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

  /** Fetch unified status (GPU usage + system info). */
  fetchStatus(): Observable<GpuStatusResponse> {
    return this.http.get<GpuStatusResponse>(this.usageUrl).pipe(
      tap({
        error: (err) => console.error("[GpuService] status fetch error:", err),
      }),
    );
  }

  /** Poll unified status every N ms, starting immediately. */
  watchStatus(intervalMs = 3000): Observable<GpuStatusResponse> {
    return timer(0, intervalMs).pipe(switchMap(() => this.fetchStatus()));
  }
}
