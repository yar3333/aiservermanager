import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable, timer } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import { SystemInfo } from "../models/system";

@Injectable({ providedIn: "root" })
export class SystemService {
  private http = inject(HttpClient);
  private readonly url = "/api/system";

  /** Fetch system info (CPU + memory). */
  fetchSystemInfo(): Observable<SystemInfo> {
    return this.http.get<SystemInfo>(this.url).pipe(
      tap({
        error: (err) => console.error("[SystemService] fetch error:", err),
      }),
    );
  }

  /** Poll system info every N ms, starting immediately. */
  watchSystemInfo(intervalMs = 3000): Observable<SystemInfo> {
    return timer(0, intervalMs).pipe(switchMap(() => this.fetchSystemInfo()));
  }
}
