import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuEnricher } from "./gpuEnricher";

/**
 * Enrich GPU entries with llama.cpp Vulkan device names (vulkan0, vulkan1, ...).
 * Uses `vulkaninfo --summary` to detect Vulkan-capable GPUs.
 * Linux only.
 */
@injectable()
export class VulkanEnricher implements GpuEnricher {
  private availableCache: boolean | null = null;

  constructor() {
    if (process.platform !== "linux") {
      this.availableCache = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache as boolean;

    const result = await ExecTools.safeExec("vulkaninfo --summary 2>/dev/null", { timeout: 5000 });
    this.availableCache = result.stdout.includes("deviceName");
    return this.availableCache;
  }

  async enrich(gpus: GpuInfo[]): Promise<void> {
    if (gpus.length === 0) return;

    const result = await ExecTools.safeExec(
      "vulkaninfo --summary 2>/dev/null | grep 'deviceName' | sed 's/.*deviceName = //'",
      {
        timeout: 10000,
      },
    );

    if (!result.stdout.trim()) return;

    // Assign llama.cpp Vulkan device names: vulkan0, vulkan1, ...
    const vulkanDevices = result.stdout.trim().split("\n").length;
    for (let i = 0; i < gpus.length && i < vulkanDevices; i++) {
      gpus[i].engineVulkanName = `vulkan${i}`;
    }
  }
}
