import { injectable } from "inversify";
import { GpuInfo, GpuUsage } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuUsageProbe } from "./gpuUsageProbe";

/**
 * Lightweight usage probe for AMD GPUs on Linux via `rocm-smi`.
 * Queries only temperature, usage%, and VRAM — skips product name.
 *
 * rocm-smi JSON keys are its own card numbers ("card0", "card1", ...) which
 * follow BDF order and are NOT related to the static GPU list order (kernel
 * probe / HIP order can differ, e.g. buses 83/86/C3/C6 probe as C3/C6/83/86).
 * So each card is resolved to its PCI bus via `--showbus` (cached once —
 * static info) and matched to GPUs by pciBusId — never positionally.
 */
@injectable()
export class AmdLinuxUsageProbe implements GpuUsageProbe {
  private availableCache: boolean | null = null;
  private cardBusesCache: Map<string, string> | null = null;

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
    if (gpus.length === 0) return [];

    const results = await Promise.all([
      ExecTools.safeExec("rocm-smi -t --json", { timeout: 10000 }),
      ExecTools.safeExec("rocm-smi -u --json", { timeout: 10000 }),
      ExecTools.safeExec("rocm-smi --showmeminfo vram --json", { timeout: 10000 }),
    ]);

    const tempData = this.parseJson(results[0].stdout);
    const usageData = this.parseJson(results[1].stdout);
    const memData = this.parseJson(results[2].stdout);

    // Match cards to GPUs by PCI bus — rocm-smi card numbering is unrelated
    // to the static list order
    const cardBuses = await this.getCardBuses();
    const knownBuses = new Set(gpus.map((g) => g.pciBusId));

    const usages: GpuUsage[] = [];
    for (const [cardKey, pciBusId] of cardBuses) {
      if (!knownBuses.has(pciBusId)) continue; // card outside the dashboard (iGPU, ...)
      usages.push(this.extractUsage(cardKey, pciBusId, tempData, usageData, memData));
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

  /** "cardN" → "BB:DD.F" (detector format), from `--showbus`. Cached — static info. */
  private async getCardBuses(): Promise<Map<string, string>> {
    if (this.cardBusesCache !== null && this.cardBusesCache.size > 0) return this.cardBusesCache;

    const map = new Map<string, string>();
    const result = await ExecTools.safeExec("rocm-smi --showbus --json", { timeout: 10000 });
    const data = this.parseJson(result.stdout);

    if (data) {
      for (const [cardKey, card] of Object.entries(data)) {
        const pci = (card as Record<string, unknown> | undefined)?.["PCI Bus"];
        if (typeof pci !== "string" || !pci.trim()) continue;
        // "0000:83:00.0" → "83:00.0" to match detector / lspci format
        map.set(cardKey, pci.trim().toUpperCase().replace(/^0+:/, ""));
      }
    }

    // Don't cache a failed/empty lookup — retry on the next poll
    if (map.size > 0) {
      this.cardBusesCache = map;
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
