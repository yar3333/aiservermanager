import { GpuInfo } from "../../types";

/**
 * Strategy interface for GPU detection.
 * Each implementation knows how to query GPUs for a specific tool / vendor / OS.
 */
export interface GpuDetector {
  /**
   * @returns true if the underlying tool is available on this system.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Detect GPUs. Only called when `isAvailable()` returns true.
   */
  detect(): Promise<GpuInfo[]>;
}
