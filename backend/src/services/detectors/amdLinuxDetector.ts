import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect AMD GPUs on Linux using `rocm-smi`.
 * Returns only static info: index, name, vramTotal, pciBusId.
 * Dynamic metrics (usage, temperature, vramUsed) are delegated to AmdLinuxUsageProbe.
 *
 * Commands (rocm-smi 6.x compatible):
 *   --showproductname --json  → product name
 *   --showmeminfo vram --json → VRAM total
 *   --showbus --json          → PCI bus ID
 */
@injectable()
export class AmdLinuxDetector implements GpuDetector {
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

  async detect(): Promise<GpuInfo[]> {
    const results = await Promise.all([
      ExecTools.safeExec("rocm-smi --showproductname --json", { timeout: 10000 }),
      ExecTools.safeExec("rocm-smi --showmeminfo vram --json", { timeout: 10000 }),
      ExecTools.safeExec("rocm-smi --showbus --json", { timeout: 10000 }),
    ]);

    if (!results[0].stdout.trim()) return [];

    const productData = this.parseJson(results[0].stdout);
    if (!productData) return [];

    const cardKeys = this.getCardKeys(productData);
    if (cardKeys.length === 0) return [];

    const memData = this.parseJson(results[1].stdout);
    const busData = this.parseJson(results[2].stdout);

    const gpus: GpuInfo[] = [];
    for (let i = 0; i < cardKeys.length; i++) {
      const key = cardKeys[i];
      gpus.push(this.parseCard(i, key, productData, memData, busData));
    }

    return gpus;
  }

  private parseJson(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw.trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private getCardKeys(data: Record<string, unknown>): string[] {
    return Object.keys(data)
      .filter((k) => k.startsWith("card"))
      .sort((a, b) => {
        const numA = parseInt(a.replace("card", ""), 10);
        const numB = parseInt(b.replace("card", ""), 10);
        return numA - numB;
      });
  }

  private parseCard(
    index: number,
    cardKey: string,
    productData: Record<string, unknown>,
    memData: Record<string, unknown> | null,
    busData: Record<string, unknown> | null,
  ): GpuInfo {
    const gpu: GpuInfo = {
      index,
      vendor: "AMD",
      brand: "RADEON",
      name: `AMD GPU ${index}`,
      engineCudaName: "",
      engineRocmName: "",
      engineVulkanName: "",
      vramTotal: 0,
      pciBusId: "",
    };

    // Product name
    const cardInfo = productData[cardKey] as Record<string, unknown> | undefined;
    if (cardInfo?.["Card Series"]) {
      gpu.name = String(cardInfo["Card Series"]);
    }

    // VRAM total (bytes → GB)
    if (memData) {
      const memCard = memData[cardKey] as Record<string, unknown> | undefined;
      const totalBytes = memCard?.["VRAM Total Memory (B)"];
      if (totalBytes !== undefined) {
        gpu.vramTotal = parseFloat(String(totalBytes)) / 1024 ** 3;
      }
    }

    // PCI Bus — strip "0000:" domain prefix to match lspci format
    if (busData) {
      const busCard = busData[cardKey] as Record<string, unknown> | undefined;
      const pciBus = busCard?.["PCI Bus"];
      if (pciBus !== undefined) {
        let bus = String(pciBus).toUpperCase();
        if (bus.startsWith("0000:")) {
          bus = bus.slice(5);
        }
        gpu.pciBusId = bus;
      }
    }

    return gpu;
  }
}
