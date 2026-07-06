import { GpuInfo } from "../types";
import { GpuDetector } from "./detectors/gpuDetector";
import { NvidiaSmiDetector } from "./detectors/nvidiaSmiDetector";
import { AmdLinuxDetector } from "./detectors/amdLinuxDetector";
import { WmiDetector } from "./detectors/wmiDetector";
import { GpuEnricher } from "./enrichers/gpuEnricher";
import { VulkanEnricher } from "./enrichers/vulkanEnricher";
import { LspciEnricher } from "./enrichers/lspciEnricher";

/**
 * Compose the platform-specific pipeline of detectors and enrichers.
 *
 * Detectors run sequentially (each may depend on previous results).
 * Enrichers run in parallel after all detection is complete.
 */
export class GpuService {
  private readonly detectors: GpuDetector[];
  private readonly enrichers: GpuEnricher[];

  constructor() {
    const isWindows = process.platform === "win32";

    this.detectors = isWindows
      ? [new NvidiaSmiDetector(), new WmiDetector()]
      : [new NvidiaSmiDetector(), new AmdLinuxDetector()];

    this.enrichers = isWindows ? [] : [new LspciEnricher(), new VulkanEnricher()];
  }

  async getGpuList(): Promise<GpuInfo[]> {
    // 1. Run detectors sequentially, merging results
    const gpus = await this.runDetectors();

    // 2. Deduplicate by GPU name (in case multiple detectors report the same card)
    const deduped = deduplicate(gpus);

    // 3. Enrich in parallel
    await this.runEnrichers(deduped);

    return deduped;
  }

  private async runDetectors(): Promise<GpuInfo[]> {
    const all: GpuInfo[] = [];

    for (const detector of this.detectors) {
      if (!(await detector.isAvailable())) continue;

      const detected = await detector.detect();
      all.push(...detected);
    }

    return all;
  }

  private async runEnrichers(gpus: GpuInfo[]): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const enricher of this.enrichers) {
      if (await enricher.isAvailable()) {
        tasks.push(enricher.enrich(gpus));
      }
    }

    await Promise.all(tasks);
  }
}

/**
 * Remove duplicate GPUs that share the same name.
 * When multiple detectors report the same card (e.g. nvidia-smi + WMI),
 * prefer the entry with more populated fields.
 */
function deduplicate(gpus: GpuInfo[]): GpuInfo[] {
  const seen = new Map<string, GpuInfo>();

  for (const gpu of gpus) {
    const existing = seen.get(gpu.name);
    if (!existing) {
      seen.set(gpu.name, gpu);
      continue;
    }

    // Keep the entry with more data (usage, temperature, VRAM details)
    const existingScore = score(existing);
    const newScore = score(gpu);
    if (newScore > existingScore) {
      seen.set(gpu.name, gpu);
    }
  }

  return [...seen.values()];
}

function score(gpu: GpuInfo): number {
  let s = 0;
  if (gpu.usage > 0) s += 2;
  if (gpu.temperature > 0) s += 2;
  if (gpu.vramUsed > 0) s += 1;
  if (gpu.vulkanName) s += 1;
  if (gpu.pciBusId) s += 1;
  return s;
}

// Default singleton instance — used by routes
const gpuService = new GpuService();

export async function getGpuList(): Promise<GpuInfo[]> {
  return gpuService.getGpuList();
}
