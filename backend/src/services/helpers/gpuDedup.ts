import { GpuInfo } from "../../models/GpuInfo";

/**
 * Remove duplicate GPUs that share the same identity.
 * When multiple detectors report the same card (e.g. nvidia-smi + WMI),
 * prefer the entry with more populated static fields.
 *
 * Identity key: vendor + pciBusId (if available), otherwise vendor + name.
 * This prevents deduplication of multiple identical GPUs (e.g. 4x RX 7900 XTX).
 */
export function deduplicateGpus(gpus: GpuInfo[]): GpuInfo[] {
  const seen = new Map<string, GpuInfo>();

  for (const gpu of gpus) {
    const key = gpu.pciBusId ? `${gpu.vendor}:${gpu.pciBusId}` : `${gpu.vendor}:${gpu.name}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, gpu);
      continue;
    }

    const existingScore = staticScore(existing);
    const newScore = staticScore(gpu);
    if (newScore > existingScore) {
      seen.set(key, gpu);
    }
  }

  return [...seen.values()];
}

/**
 * Score a static GpuInfo record — higher = more populated.
 * Used during deduplication to decide which entry to keep.
 */
export function staticScore(gpu: GpuInfo): number {
  let s = 0;
  if (gpu.pciBusId) s += 2;
  if (gpu.vramTotal > 0) s += 1;
  if (gpu.engineVulkanName) s += 1;
  if (gpu.brand && gpu.brand !== gpu.vendor) s += 1; // enricher filled a real brand
  return s;
}
