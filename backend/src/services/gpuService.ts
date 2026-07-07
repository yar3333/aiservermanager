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

    // 3. Enrich in parallel (lspci brand, vulkan device names, ...)
    await this.runEnrichers(deduped);

    // 4. Assign llama.cpp engine device names (cuda0, rocm0, ...)
    assignEngineNames(deduped);

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
 * Remove duplicate GPUs that share the same identity.
 * When multiple detectors report the same card (e.g. nvidia-smi + WMI),
 * prefer the entry with more populated fields.
 *
 * Identity key: vendor + pciBusId (if available), otherwise vendor + name.
 * This prevents deduplication of multiple identical GPUs (e.g. 4x RX 7900 XTX).
 */
function deduplicate(gpus: GpuInfo[]): GpuInfo[] {
  const seen = new Map<string, GpuInfo>();

  for (const gpu of gpus) {
    const key = gpu.pciBusId ? `${gpu.vendor}:${gpu.pciBusId}` : `${gpu.vendor}:${gpu.name}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, gpu);
      continue;
    }

    // Keep the entry with more data (usage, temperature, VRAM details)
    const existingScore = score(existing);
    const newScore = score(gpu);
    if (newScore > existingScore) {
      seen.set(key, gpu);
    }
  }

  return [...seen.values()];
}

function score(gpu: GpuInfo): number {
  let s = 0;
  if (gpu.usage > 0) s += 2;
  if (gpu.temperature > 0) s += 2;
  if (gpu.vramUsed > 0) s += 1;
  if (gpu.engineVulkanName) s += 1;
  if (gpu.pciBusId) s += 1;
  return s;
}

/**
 * Assign llama.cpp engine device names based on vendor.
 * NVIDIA GPUs get cuda0, cuda1, ...
 * AMD GPUs get rocm0, rocm1, ...
 * Vulkan names are assigned by the VulkanEnricher.
 */
function assignEngineNames(gpus: GpuInfo[]): void {
  let cudaIndex = 0;
  let rocmIndex = 0;

  for (const gpu of gpus) {
    if (gpu.vendor === "NVIDIA" && !gpu.engineCudaName) {
      gpu.engineCudaName = `cuda${cudaIndex++}`;
    }
    if (gpu.vendor === "AMD" && !gpu.engineRocmName) {
      gpu.engineRocmName = `rocm${rocmIndex++}`;
    }
  }
}
