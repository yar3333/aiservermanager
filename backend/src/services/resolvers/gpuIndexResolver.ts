import { GpuInfo } from "../../models/GpuInfo";

/**
 * Strategy interface for assigning the device number (gpuIndex) to each
 * GPU — its position in the device list, used for display and device
 * selection (e.g. `rocm<gpuIndex>` / `cuda<gpuIndex>`).
 *
 * Resolvers are tried in DI binding order; the first one that assigns at
 * least one index wins. New platform- or vendor-specific methods can be
 * added as additional bindings without touching GpuService.
 */
export interface GpuIndexResolver {
  /**
   * @returns true if the underlying mechanism is available on this system.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Assign gpuIndex to the GPUs this resolver can match.
   * @returns the number of GPUs that received an index.
   */
  resolve(gpus: GpuInfo[]): Promise<number>;
}
