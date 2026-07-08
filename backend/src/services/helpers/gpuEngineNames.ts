import { GpuInfo } from "../../models/GpuInfo";

/**
 * Assign llama.cpp engine device names based on vendor.
 * NVIDIA GPUs get cuda0, cuda1, ...
 * AMD GPUs get rocm0, rocm1, ...
 * Vulkan names are assigned by the VulkanEnricher.
 */
export function assignEngineNames(gpus: GpuInfo[]): void {
  let cudaIndex = 0;
  let rocmIndex = 0;

  for (const gpu of gpus) {
    if (gpu.vendor === "NVIDIA" && !gpu.engineCudaName) {
      gpu.engineCudaName = `cuda${cudaIndex++}`;
    }
    if (gpu.vendor === "AMD" && !gpu.engineRocmName) {
      gpu.engineRocmName = `rocm${rocmIndex++}`;
    }
  }
}
