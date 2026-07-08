/** Static GPU information — does not change during runtime. */
export interface GpuInfo {
  index: number;
  vendor: string;
  brand: string;
  name: string;
  engineCudaName: string;
  engineRocmName: string;
  engineVulkanName: string;
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
