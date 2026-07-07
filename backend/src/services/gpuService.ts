import { injectable, multiInject } from "inversify";
import { GpuInfo } from "../types";
import { GPU_DETECTOR, GPU_ENRICHER } from "../di/types";
import { GpuDetector } from "./detectors/gpuDetector";
import { GpuEnricher } from "./enrichers/gpuEnricher";

/**
 * Compose the platform-specific pipeline of detectors and enrichers.
 *
 * Detectors run sequentially (each may depend on previous results).
 * Enrichers run in parallel after all detection is complete.
 *
 * All dependencies are injected by InversifyJS via multiInject.
 */
@injectable()
export class GpuService {
  private readonly detectors: GpuDetector[];
  private readonly enrichers: GpuEnricher[];

  constructor(
    @multiInject(GPU_DETECTOR) detectors: GpuDetector[],
    @multiInject(GPU_ENRICHER) enrichers: GpuEnricher[],
  ) {
    this.detectors = detectors;
    this.enrichers = enrichers;
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
