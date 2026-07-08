import { GpuInfo, GpuUsage } from "../../models/GpuInfo";

/**
 * Lightweight strategy for polling dynamic GPU metrics (usage, temperature, VRAM).
 * Probes run after the static GPU list has been bootstrapped.
 */
export interface GpuUsageProbe {
  /**
   * @returns true if the underlying tool is available on this system.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Query dynamic metrics for the given GPUs.
   * @param gpus Static GPU info used to know which devices to query.
   * @returns Array of GpuUsage entries keyed by pciBusId (or vendor:index fallback).
   */
  probe(gpus: GpuInfo[]): Promise<GpuUsage[]>;
}
