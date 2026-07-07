import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuEnricher } from "./gpuEnricher";

/**
 * Enrich GPU entries with PCI brand (ASRock, MSI, Gigabyte, etc.) using `lspci -vnn`.
 * Linux only.
 */
@injectable()
export class LspciEnricher implements GpuEnricher {
  private availableCache: boolean | null = null;

  constructor() {
    if (process.platform !== "linux") {
      this.availableCache = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache as boolean;

    const result = await ExecTools.safeExec("lspci -vnn 2>/dev/null", { timeout: 5000 });
    this.availableCache = result.stdout.includes("VGA") || result.stdout.includes("3D");
    return this.availableCache;
  }

  async enrich(gpus: GpuInfo[]): Promise<void> {
    if (gpus.length === 0) return;

    const result = await ExecTools.safeExec("lspci -vnn | grep -A 3 -E 'VGA|3D|Display'", {
      timeout: 10000,
    });

    if (!result.stdout.trim()) return;

    const brandMap = this.parseBlocks(result.stdout);

    for (const gpu of gpus) {
      const key = gpu.pciBusId.toUpperCase();
      if (brandMap[key]) {
        gpu.brand = brandMap[key];
      }
    }
  }

  private parseBlocks(raw: string): Record<string, string> {
    const map: Record<string, string> = {};

    const blocks = raw.split(/\n--\n|\n--$/m);

    for (const block of blocks) {
      const pciMatch = block.match(/^([0-9a-fA-F]+):([0-9a-fA-F]+)\.([0-9])/);
      if (!pciMatch) continue;

      const busId = `${pciMatch[1]}:${pciMatch[2]}.${pciMatch[3]}`.toUpperCase();
      const brand = detectBrand(block);
      if (brand) map[busId] = brand;
    }

    return map;
  }
}

function detectBrand(block: string): string {
  const upper = block.toUpperCase();
  if (upper.includes("ASROK") || upper.includes("ASROCK")) return "ASROCK";
  if (upper.includes("MICRO-STAR")) return "MSI";
  if (upper.includes("GIGABYTE")) return "GIGABYTE";
  if (upper.includes("EVGA")) return "EVGA";
  if (upper.includes("ZOTAC")) return "ZOTAC";
  if (upper.includes("SAPPHIRE")) return "SAPPHIRE";
  if (upper.includes("POWERCOLOR")) return "POWERCOLOR";
  if (upper.includes("XFX")) return "XFX";
  return "";
}
