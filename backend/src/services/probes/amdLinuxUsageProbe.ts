import { injectable } from "inversify";
import { GpuInfo, GpuUsage } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuUsageProbe } from "./gpuUsageProbe";

/**
 * Lightweight usage probe for AMD GPUs on Linux via `rocm-smi`.
 * Queries only temperature, usage%, and VRAM — skips product name and bus info.
 */
@injectable()
export class AmdLinuxUsageProbe implements GpuUsageProbe {
  private availableCache: boolean | null = null;

  constructor() {
    if (process.platform !== "linux") {
      this.availableCache = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await ExecTools.safeExec("rocm-smi --showproductname --json", { timeout: 5000 });
    const available = result.stdout.trim().length > 0;
    if (available) {
      this.availableCache = true;
    }
    return available;
  }

  async probe(gpus: GpuInfo[]): Promise<GpuUsage[]> {
    const results = await Promise.all([
      ExecTools.safeExec("rocm-smi -t --json", { timeout: 10000 }),
      ExecTools.safeExec("rocm-smi -u --json", { timeout: 10000 }),
      ExecTools.safeExec("rocm-smi --showmeminfo vram --json", { timeout: 10000 }),
    ]);

    const tempData = this.parseJson(results[0].stdout);
    const usageData = this.parseJson(results[1].stdout);
    const memData = this.parseJson(results[2].stdout);

    // Build card→key mapping from static GPU info
    const keyMap = this.buildKeyMap(gpus);

    const usages: GpuUsage[] = [];

    for (const [cardKey, matchKey] of keyMap) {
      usages.push(this.extractUsage(cardKey, matchKey, tempData, usageData, memData));
    }

    return usages;
  }

  private parseJson(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw.trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Build cardKey → matchKey mapping.
   * matchKey is the pciBusId from static info (or "AMD:index" fallback).
   */
  private buildKeyMap(gpus: GpuInfo[]): Map<string, string> {
    const map = new Map<string, string>();
    const cardKeys: string[] = [];

    for (let i = 0; i < gpus.length; i++) {
      const cardKey = `card${i}`;
      const gpu = gpus[i];
      const matchKey = gpu.pciBusId || `AMD:${i}`;
      map.set(cardKey, matchKey);
      cardKeys.push(cardKey);
    }

    return map;
  }

  private extractUsage(
    cardKey: string,
    matchKey: string,
    tempData: Record<string, unknown> | null,
    usageData: Record<string, unknown> | null,
    memData: Record<string, unknown> | null,
  ): GpuUsage {
    const entry: GpuUsage = { key: matchKey, usage: 0, temperature: 0, vramUsed: 0 };

    // Temperature
    if (tempData) {
      const card = tempData[cardKey] as Record<string, unknown> | undefined;
      const val = card?.["Temperature (Sensor edge) (C)"];
      if (val !== undefined) entry.temperature = parseFloat(String(val)) || 0;
    }

    // Usage %
    if (usageData) {
      const card = usageData[cardKey] as Record<string, unknown> | undefined;
      const val = card?.["GPU use (%)"];
      if (val !== undefined) entry.usage = parseFloat(String(val)) || 0;
    }

    // VRAM used (bytes → GB)
    if (memData) {
      const card = memData[cardKey] as Record<string, unknown> | undefined;
      const usedBytes = card?.["VRAM Total Used Memory (B)"];
      if (usedBytes !== undefined) {
        entry.vramUsed = parseFloat(String(usedBytes)) / 1024 ** 3;
      }
    }

    return entry;
  }
}
