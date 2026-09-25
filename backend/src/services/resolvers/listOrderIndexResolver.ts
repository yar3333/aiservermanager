import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { GpuIndexResolver } from "./gpuIndexResolver";

/**
 * Fallback resolver: assigns gpuIndex sequentially (0, 1, 2, ...) in
 * detector list order. Platform-agnostic — used when no system-specific
 * resolver matches (e.g. Windows, where the detector order already follows
 * the runtime device order).
 */
@injectable()
export class ListOrderIndexResolver implements GpuIndexResolver {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async resolve(gpus: GpuInfo[]): Promise<number> {
    gpus.forEach((gpu, i) => {
      gpu.gpuIndex = i;
    });
    return gpus.length;
  }
}
