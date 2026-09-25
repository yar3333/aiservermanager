/** Static GPU information — does not change during runtime. */
export interface GpuInfo {
  /** Detector's own enumeration order (e.g. rocm-smi / nvidia-smi index). */
  index: number;
  vendor: string;
  brand: string;
  name: string;
  /**
   * Device number — sequential position in the list sorted by PCIe address
   * (BDF: bus, device, function). Assigned at bootstrap by an index
   * resolver; 0 when unresolved.
   * Deliberately not the kernel probe order (HIP/KFD agents), which can
   * differ from BDF order.
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
