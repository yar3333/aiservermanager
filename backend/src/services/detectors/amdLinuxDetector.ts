import { injectable } from "inversify";
import { GpuInfo } from "../../types";
import { safeExec } from "../exec";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect AMD GPUs on Linux using `rocm-smi`.
 *
 * Commands (rocm-smi 6.x compatible):
 *   --showproductname --json  → {"card0": {"Card Series": "..."}, ...}
 *   -t --json                 → {"card0": {"Temperature (Sensor edge) (C)": "42.0"}, ...}
 *   -u --json                 → {"card0": {"GPU use (%)": "0"}, ...}
 *   --showmeminfo vram --json → {"card0": {"VRAM Total Memory (B)": "..."}, ...}
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

    const result = await safeExec("rocm-smi --showproductname --json", { timeout: 5000 });
    this.availableCache = result.stdout.trim().length > 0;
    return this.availableCache;
  }

  async detect(): Promise<GpuInfo[]> {
    const results = await Promise.all([
      safeExec("rocm-smi --showproductname --json", { timeout: 10000 }),
      safeExec("rocm-smi -t --json", { timeout: 10000 }),
      safeExec("rocm-smi -u --json", { timeout: 10000 }),
      safeExec("rocm-smi --showmeminfo vram --json", { timeout: 10000 }),
      safeExec("rocm-smi --showbus --json", { timeout: 10000 }),
    ]);

    if (!results[0].stdout.trim()) return [];

    const productData = this.parseJson(results[0].stdout);
    if (!productData) return [];

    const cardKeys = this.getCardKeys(productData);
    if (cardKeys.length === 0) return [];

    const tempData = this.parseJson(results[1].stdout);
    const usageData = this.parseJson(results[2].stdout);
    const memData = this.parseJson(results[3].stdout);
    const busData = this.parseJson(results[4].stdout);

    const gpus: GpuInfo[] = [];
    for (let i = 0; i < cardKeys.length; i++) {
      const key = cardKeys[i];
      gpus.push(this.parseCard(i, key, productData, tempData, usageData, memData, busData));
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
    tempData: Record<string, unknown> | null,
    usageData: Record<string, unknown> | null,
    memData: Record<string, unknown> | null,
    busData: Record<string, unknown> | null,
  ): GpuInfo {
    const gpu: GpuInfo = {
      index,
      vendor: "AMD",
      brand: "RADEON",
      name: `AMD GPU ${index}`,
      vulkanName: "",
      vramTotal: 0,
      vramUsed: 0,
      usage: 0,
      temperature: 0,
      pciBusId: "",
    };

    // Product name
    const cardInfo = productData[cardKey] as Record<string, unknown> | undefined;
    if (cardInfo?.["Card Series"]) {
      gpu.name = String(cardInfo["Card Series"]);
      gpu.vulkanName = gpu.name;
    }

    // Temperature (Sensor edge)
    if (tempData) {
      const tempCard = tempData[cardKey] as Record<string, unknown> | undefined;
      const tempStr = tempCard?.["Temperature (Sensor edge) (C)"];
      if (tempStr !== undefined) {
        gpu.temperature = parseFloat(String(tempStr)) || 0;
      }
    }

    // GPU usage
    if (usageData) {
      const usageCard = usageData[cardKey] as Record<string, unknown> | undefined;
      const usageStr = usageCard?.["GPU use (%)"];
      if (usageStr !== undefined) {
        gpu.usage = parseFloat(String(usageStr)) || 0;
      }
    }

    // VRAM (bytes → GB)
    if (memData) {
      const memCard = memData[cardKey] as Record<string, unknown> | undefined;
      const totalBytes = memCard?.["VRAM Total Memory (B)"];
      const usedBytes = memCard?.["VRAM Total Used Memory (B)"];
      if (totalBytes !== undefined) {
        gpu.vramTotal = parseFloat(String(totalBytes)) / 1024 ** 3;
      }
      if (usedBytes !== undefined) {
        gpu.vramUsed = parseFloat(String(usedBytes)) / 1024 ** 3;
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
