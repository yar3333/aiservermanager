import { GpuInfo } from "../../types";
import { safeExec } from "../exec";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect AMD GPUs on Linux using `rocm-smi`.
 */
export class AmdLinuxDetector implements GpuDetector {
  private availableCache: boolean | null = null;

  constructor() {
    if (process.platform !== "linux") {
      this.availableCache = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await safeExec("rocm-smi --showproductname --json", { timeout: 5000 });
    this.availableCache = result.stdout.trim().length > 0;
    return this.availableCache;
  }

  async detect(): Promise<GpuInfo[]> {
    const results = await Promise.all([
      safeExec("rocm-smi --showproductname --json", { timeout: 10000 }),
      safeExec("rocm-smi --showtemperature --json", { timeout: 10000 }),
      safeExec("rocm-smi --showusage --json", { timeout: 10000 }),
      safeExec("rocm-smi --showmemusage --json", { timeout: 10000 }),
    ]);

    if (!results[0].stdout.trim()) return [];

    let count = 0;
    try {
      count = JSON.parse(results[0].stdout).card_count ?? 0;
    } catch {
      return [];
    }

    const gpus: GpuInfo[] = [];

    for (let i = 0; i < count; i++) {
      const gpu = this.parseCard(i, results);
      gpus.push(gpu);
    }

    return gpus;
  }

  private parseCard(i: number, results: Array<{ stdout: string; stderr: string }>): GpuInfo {
    const gpu: GpuInfo = {
      index: i,
      vendor: "AMD",
      brand: "RADEON",
      name: `AMD GPU ${i}`,
      vulkanName: "",
      vramTotal: 0,
      vramUsed: 0,
      usage: 0,
      temperature: 0,
      pciBusId: "",
    };

    try {
      gpu.name = JSON.parse(results[0].stdout).card_product_name?.[i] ?? gpu.name;
      gpu.vulkanName = gpu.name;
    } catch { /* keep default */ }

    try {
      gpu.temperature = JSON.parse(results[1].stdout).card_temperature?.[i] ?? 0;
    } catch { /* keep default */ }

    try {
      gpu.usage = JSON.parse(results[2].stdout).gpu_usage_percent?.[i] ?? 0;
    } catch { /* keep default */ }

    return gpu;
  }
}
