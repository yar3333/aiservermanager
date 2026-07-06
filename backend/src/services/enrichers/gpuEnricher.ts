import { GpuInfo } from "../../types";

/**
 * Strategy interface for GPU data enrichment.
 * Enrichers mutate the GpuInfo[] in-place with additional metadata
 * discovered from system tools (vulkaninfo, lspci, etc.).
 */
export interface GpuEnricher {
  /**
   * @returns true if the underlying tool is available on this system.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Enrich the provided GPU list. Only called when `isAvailable()` returns true.
   */
  enrich(gpus: GpuInfo[]): Promise<void>;
}
