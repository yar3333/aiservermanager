import { injectable, multiInject } from "inversify";
import { GpuInfo, GpuUsage } from "../models/GpuInfo";
import { GPU_DETECTOR, GPU_ENRICHER, GPU_USAGE_PROBE } from "../di/types";
import { GpuDetector } from "./detectors/gpuDetector";
import { GpuEnricher } from "./enrichers/gpuEnricher";
import { GpuUsageProbe } from "./probes/gpuUsageProbe";
import { deduplicateGpus } from "./helpers/gpuDedup";
import { assignEngineNames } from "./helpers/gpuEngineNames";

/**
 * Orchestrates GPU detection and usage polling.
 *
 * Bootstrap (runs once): detectors → dedup → enrichers → engine names.
 * Usage polling (every request): probes → GpuUsage[].
 *
 * Two access patterns:
 *   - getStaticGpus() → GpuInfo[]  (cached)
 *   - getUsage()      → GpuUsage[] (fresh each call)
 */
@injectable()
export class GpuService {
  private readonly detectors: GpuDetector[];
  private readonly enrichers: GpuEnricher[];
  private readonly probes: GpuUsageProbe[];
  private cachedGpus: GpuInfo[] | null = null;

  constructor(
    @multiInject(GPU_DETECTOR) detectors: GpuDetector[],
    @multiInject(GPU_ENRICHER) enrichers: GpuEnricher[],
    @multiInject(GPU_USAGE_PROBE) probes: GpuUsageProbe[],
  ) {
    this.detectors = detectors;
    this.enrichers = enrichers;
    this.probes = probes;
  }

  /**
   * Return static GPU info (bootstraps on first call, then caches).
   */
  async getStaticGpus(): Promise<GpuInfo[]> {
    if (!this.cachedGpus) {
      this.cachedGpus = await this.bootstrap();
    }
    return this.cachedGpus;
  }

  /**
   * Return only dynamic usage metrics.
   */
  async getUsage(): Promise<GpuUsage[]> {
    const staticGpus = await this.getStaticGpus();
    return this.runProbes(staticGpus);
  }

  /**
   * Full pipeline: detectors → dedup → enrichers → engine names.
   */
  private async bootstrap(): Promise<GpuInfo[]> {
    const gpus = await this.runDetectors();
    const deduped = deduplicateGpus(gpus);
    await this.runEnrichers(deduped);
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

  private async runProbes(gpus: GpuInfo[]): Promise<GpuUsage[]> {
    const all: GpuUsage[] = [];

    for (const probe of this.probes) {
      if (!(await probe.isAvailable())) continue;

      const result = await probe.probe(gpus);
      all.push(...result);
    }

    return all;
  }
}
