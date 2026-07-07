import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, timer } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import { Gpu } from "../models/gpu";

@Injectable({ providedIn: "root" })
export class GpuService {
  private http = inject(HttpClient);
  private readonly apiUrl = "/api/gpus";

  fetchGpus(): Observable<Gpu[]> {
    return this.http.get<Gpu[]>(this.apiUrl).pipe(
      tap({
        next: (data) => {
          //console.log("[GpuService] raw response:", data);
        },
        error: (err) => console.error("[GpuService] HTTP error:", err),
      }),
    );
  }

  /** Poll GPUs every 3 seconds, starting immediately. */
  watchGpus(intervalMs = 3000): Observable<Gpu[]> {
    return timer(0, intervalMs).pipe(switchMap(() => this.fetchGpus()));
  }
}
