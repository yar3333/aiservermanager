import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { HfDownload, HfStatus } from "../models/hf";

type HfAction = "pause" | "resume" | "cancel";

@Injectable({ providedIn: "root" })
export class HfService {
  private http = inject(HttpClient);
  private readonly baseUrl = "/api/hf";

  async getStatus(): Promise<HfStatus> {
    return firstValueFrom(this.http.get<HfStatus>(`${this.baseUrl}/status`));
  }

  async getDownloads(): Promise<HfDownload[]> {
    return firstValueFrom(this.http.get<HfDownload[]>(`${this.baseUrl}/downloads`));
  }

  async action(action: HfAction, download: HfDownload): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.baseUrl}/downloads/action`, { action, repoId: download.repoId, dest: download.dest }),
    );
  }
}
