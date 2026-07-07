import { injectable } from "inversify";
import { GpuInfo } from "../../types";
import { safeExec } from "../exec";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect NVIDIA GPUs using `nvidia-smi`.
 * Works on both Linux and Windows.
 */
@injectable()
export class NvidiaSmiDetector implements GpuDetector {
  private availableCache: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await safeExec("nvidia-smi --query-gpu=index --format=csv,noheader,nounits", {
      timeout: 5000,
    });
    this.availableCache = result.stdout.trim().length > 0;
    return this.availableCache;
  }

  async detect(): Promise<GpuInfo[]> {
    const result = await safeExec(
      "nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu,pci.bus_id --format=csv,noheader,nounits",
      { timeout: 10000 },
    );

    if (!result.stdout.trim()) return [];

    return this.parseCsv(result.stdout);
  }

  private parseCsv(raw: string): GpuInfo[] {
    const gpus: GpuInfo[] = [];

    for (const line of raw.trim().split("\n")) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 7) continue;

      const name = parts[1];
      const vramTotalMiB = parseFloat(parts[2]);
      const vramUsedMiB = parseFloat(parts[3]);
      const usage = parseFloat(parts[4]);
      const temperature = parseFloat(parts[5]);
      let busId = parts[6];
      // Normalize to lspci format: strip "0000:" domain prefix (Linux)
      if (busId.startsWith("0000:")) {
        busId = busId.slice(5);
      }

      gpus.push({
        index: parseInt(parts[0], 10),
        vendor: "NVIDIA",
        brand: "NVIDIA",
        name,
        engineCudaName: "",
        engineRocmName: "",
        engineVulkanName: "",
        vramTotal: Math.round(vramTotalMiB / 1024),
        vramUsed: Math.round(vramUsedMiB / 1024),
        usage: Number.isNaN(usage) ? 0 : usage,
        temperature: Number.isNaN(temperature) ? 0 : temperature,
        pciBusId: busId,
      });
    }

    return gpus;
  }
}
