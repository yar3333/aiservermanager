import { injectable } from "inversify";
import { GpuInfo, GpuUsage } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuUsageProbe } from "./gpuUsageProbe";

/**
 * Lightweight usage probe for NVIDIA GPUs.
 * Queries only utilization.gpu, temperature.gpu, memory.used — no name/brand/PCI.
 */
@injectable()
export class NvidiaSmiUsageProbe implements GpuUsageProbe {
  private availableCache: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await ExecTools.safeExec("nvidia-smi --query-gpu=index --format=csv,noheader,nounits", {
      timeout: 5000,
    });
    this.availableCache = result.stdout.trim().length > 0;
    return this.availableCache;
  }

  async probe(_gpus: GpuInfo[]): Promise<GpuUsage[]> {
    const result = await ExecTools.safeExec(
      "nvidia-smi --query-gpu=index,utilization.gpu,temperature.gpu,memory.used,pci.bus_id --format=csv,noheader,nounits",
      { timeout: 10000 },
    );

    if (!result.stdout.trim()) return [];

    return this.parseCsv(result.stdout);
  }

  private parseCsv(raw: string): GpuUsage[] {
    const usages: GpuUsage[] = [];

    for (const line of raw.trim().split("\n")) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 5) continue;

      const index = parseInt(parts[0], 10);
      const usage = parseFloat(parts[1]);
      const temperature = parseFloat(parts[2]);
      const vramUsedMiB = parseFloat(parts[3]);
      let busId = parts[4];

      // Normalize to lspci format: strip "0000:" domain prefix (Linux)
      if (busId.startsWith("0000:")) {
        busId = busId.slice(5);
      }

      // Key: prefer pciBusId, fallback to index
      const key = busId || `NVIDIA:${index}`;

      usages.push({
        key,
        usage: Number.isNaN(usage) ? 0 : usage,
        temperature: Number.isNaN(temperature) ? 0 : temperature,
        vramUsed: Math.round(vramUsedMiB / 1024),
      });
    }

    return usages;
  }
}
