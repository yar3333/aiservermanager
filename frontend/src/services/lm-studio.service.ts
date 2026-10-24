import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { LmStudioModel } from "../models/lm-studio";

@Injectable({ providedIn: "root" })
export class LmStudioService {
  private http = inject(HttpClient);
  private readonly baseUrl = "/api/lmstudio";

  /** Models downloaded via LM Studio (with sizes). */
  async getModels(): Promise<LmStudioModel[]> {
    return firstValueFrom(this.http.get<LmStudioModel[]>(`${this.baseUrl}/models`));
  }

  /** Delete a model directory from the LM Studio folder (name = "publisher/model"). */
  async deleteModel(name: string): Promise<void> {
    const [org, ...rest] = name.split("/");
    await firstValueFrom(this.http.delete(`${this.baseUrl}/models/${org}/${rest.join("/")}`));
  }
}
