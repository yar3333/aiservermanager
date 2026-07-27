import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect NVIDIA GPUs using `nvidia-smi`.
 * Returns only static info: index, name, vramTotal, pciBusId.
 * Dynamic metrics (usage, temperature, vramUsed) are delegated to NvidiaSmiUsageProbe.
 */
@injectable()
export class NvidiaSmiDetector implements GpuDetector {
  private availableCache: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await ExecTools.safeExec("nvidia-smi --query-gpu=index --format=csv,noheader,nounits", {
      timeout: 5000,
    });
    const available = result.stdout.trim().length > 0;
    if (available) {
      this.availableCache = true;
    }
    return available;
  }

  async detect(): Promise<GpuInfo[]> {
    const result = await ExecTools.safeExec(
      "nvidia-smi --query-gpu=index,name,memory.total,pci.bus_id --format=csv,noheader,nounits",
      { timeout: 10000 },
    );

    if (!result.stdout.trim()) return [];

    return this.parseCsv(result.stdout);
  }

  private parseCsv(raw: string): GpuInfo[] {
    const gpus: GpuInfo[] = [];

    for (const line of raw.trim().split("\n")) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts.length < 4) continue;

      const name = parts[1];
      const vramTotalMiB = parseFloat(parts[2]);
      let busId = parts[3];

      // Normalize: strip PCI domain prefix (e.g. "0000:" on Linux or "00000000:" on Windows)
      busId = busId.replace(/^0+:/, "");

      gpus.push({
        index: parseInt(parts[0], 10),
        vendor: "NVIDIA",
        brand: "NVIDIA",
        name,
        engineCudaName: "",
        engineRocmName: "",
        engineVulkanName: "",
        vramTotal: Math.round(vramTotalMiB / 1024),
        pciBusId: busId,
      });
    }

    return gpus;
  }
}
