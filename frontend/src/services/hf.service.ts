import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { HfDownload, HfLocalModel, HfOrphanBlob, HfStatus } from "../models/hf";

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

  /** Models already in the local Hugging Face cache (with sizes). */
  async getLocalModels(): Promise<HfLocalModel[]> {
    return firstValueFrom(this.http.get<HfLocalModel[]>(`${this.baseUrl}/models`));
  }

  /** Delete a model's cache directory (name = "org/model"). */
  async deleteLocalModel(name: string): Promise<void> {
    const [org, ...rest] = name.split("/");
    await firstValueFrom(this.http.delete(`${this.baseUrl}/models/${org}/${rest.join("/")}`));
  }

  /** Blob files in the shared hub/blobs referenced by no model (older than 24h). */
  async getOrphanBlobs(): Promise<HfOrphanBlob[]> {
    return firstValueFrom(this.http.get<HfOrphanBlob[]>(`${this.baseUrl}/models/orphans`));
  }

  /** Delete all orphan blobs; returns { removed, freed }. */
  async cleanupOrphanBlobs(): Promise<{ removed: number; freed: number }> {
    return firstValueFrom(this.http.post<{ removed: number; freed: number }>(`${this.baseUrl}/models/orphans/cleanup`, {}));
  }

  async action(action: HfAction, download: HfDownload): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.baseUrl}/downloads/action`, { action, repoId: download.repoId, dest: download.dest }),
    );
  }
}
