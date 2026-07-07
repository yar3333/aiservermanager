export interface GpuInfo {
  index: number;
  vendor: string;
  brand: string;
  name: string;
  engineCudaName: string;
  engineRocmName: string;
  engineVulkanName: string;
  vramTotal: number;
  vramUsed: number;
  usage: number;
  temperature: number;
  pciBusId: string;
}
