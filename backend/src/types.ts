export interface GpuInfo {
  index: number;
  vendor: string;
  brand: string;
  name: string;
  vulkanName: string;
  vramTotal: number;
  vramUsed: number;
  usage: number;
  temperature: number;
  pciBusId: string;
}
