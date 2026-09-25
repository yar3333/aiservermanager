/** Static GPU information — does not change during runtime. */
export interface GpuInfo {
  /** Detector's own enumeration order (e.g. rocm-smi / nvidia-smi index). */
  index: number;
  vendor: string;
  brand: string;
  name: string;
  /**
   * Runtime device number — the value used in HIP_VISIBLE_DEVICES /
   * CUDA_VISIBLE_DEVICES. Assigned at bootstrap by an index resolver
   * (kernel probe order on Linux); 0 when unresolved.
   * On mixed-vendor systems this is the global probe order, not a
   * vendor-local HIP/CUDA index.
   */
  gpuIndex: number;
  vramTotal: number;
  pciBusId: string;
}

/** Dynamic GPU metrics — changes on every poll. */
export interface GpuUsage {
  /** Key to match against GpuInfo.pciBusId. */
  key: string;
  usage: number;
  temperature: number;
  vramUsed: number;
}
