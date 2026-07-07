import { injectable } from "inversify";
import { GpuInfo } from "../../types";
import { safeExec } from "../exec";
import { GpuEnricher } from "./gpuEnricher";

/**
 * Enrich GPU entries with Vulkan device names using `vulkaninfo --summary`.
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
    if (this.availableCache !== null) return this.availableCache;

    const result = await safeExec("vulkaninfo --summary 2>/dev/null", { timeout: 5000 });
    this.availableCache = result.stdout.includes("deviceName");
    return this.availableCache;
  }

  async enrich(gpus: GpuInfo[]): Promise<void> {
    if (gpus.length === 0) return;

    const result = await safeExec("vulkaninfo --summary 2>/dev/null | grep 'deviceName' | sed 's/.*deviceName = //'", {
      timeout: 10000,
    });

    if (!result.stdout.trim()) return;

    const names = result.stdout
      .trim()
      .split("\n")
      .map((s) => s.trim());

    for (let i = 0; i < gpus.length && i < names.length; i++) {
      if (names[i]) {
        gpus[i].vulkanName = names[i];
      }
    }
  }
}
