import { inject, injectable, multiInject } from "inversify";
import { GpuInfo, GpuUsage } from "../models/GpuInfo";
import { GPU_DETECTOR, GPU_ENRICHER, GPU_LABEL_MANAGER, GPU_USAGE_PROBE } from "../di/types";
import { GpuDetector } from "./detectors/gpuDetector";
import { GpuEnricher } from "./enrichers/gpuEnricher";
import { GpuUsageProbe } from "./probes/gpuUsageProbe";
import { GpuLabelManager } from "./gpuLabelManager";
import { deduplicateGpus } from "./helpers/gpuDedup";

/**
 * Orchestrates GPU detection and usage polling.
 *
 * Bootstrap (runs once): detectors → dedup → enrichers → saved GPU labels.
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
  private readonly gpuLabelManager: GpuLabelManager;
  private cachedGpus: GpuInfo[] | null = null;

  constructor(
    @multiInject(GPU_DETECTOR) detectors: GpuDetector[],
    @multiInject(GPU_ENRICHER) enrichers: GpuEnricher[],
    @multiInject(GPU_USAGE_PROBE) probes: GpuUsageProbe[],
    @inject(GPU_LABEL_MANAGER) gpuLabelManager: GpuLabelManager,
  ) {
    this.detectors = detectors;
    this.enrichers = enrichers;
    this.probes = probes;
    this.gpuLabelManager = gpuLabelManager;
  }

  /**
   * Return static GPU info (bootstraps on first call, then caches).
   */
  async getStaticGpus(): Promise<GpuInfo[]> {
    if (!this.cachedGpus) {
      const gpus = await this.bootstrap();
      if (gpus.length > 0) {
        this.cachedGpus = gpus;
      }
      return gpus;
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
   * Full pipeline: detectors → dedup → enrichers → saved GPU labels.
   */
  private async bootstrap(): Promise<GpuInfo[]> {
    const gpus = await this.runDetectors();
    const deduped = deduplicateGpus(gpus);
    await this.runEnrichers(deduped);
    this.applySavedGpuLabels(deduped);
    return deduped;
  }

  /** Overwrite gpu.gpuLabel with user-defined values from the config file. */
  private applySavedGpuLabels(gpus: GpuInfo[]): void {
    const saved = this.gpuLabelManager.getAll();
    for (const gpu of gpus) {
      if (gpu.pciBusId && saved[gpu.pciBusId] !== undefined) {
        gpu.gpuLabel = saved[gpu.pciBusId];
      }
    }
  }

  /**
   * Persist the user-defined label for a GPU (identified by pciBusId)
   * and refresh the cached entry so a running backend serves the new value.
   */
  setGpuLabel(pciBusId: string, gpuLabel: string): void {
    this.gpuLabelManager.set(pciBusId, gpuLabel);
    const gpu = this.cachedGpus?.find((g) => g.pciBusId === pciBusId);
    if (gpu) {
      gpu.gpuLabel = gpuLabel.trim();
    }
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
