import { injectable } from "inversify";
import { GpuInfo } from "../../types";
import { safeExec } from "../exec";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect GPUs on Windows using PowerShell WMI (Win32_VideoController).
 * Supports all vendors — NVIDIA, AMD, Intel.
 * Usage and temperature are not available through WMI.
 */
@injectable()
export class WmiDetector implements GpuDetector {
  private availableCache: boolean | null = null;

  constructor() {
    if (process.platform !== "win32") {
      this.availableCache = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await safeExec(
      "Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1 | ConvertTo-Json",
      { timeout: 8000 },
    );
    this.availableCache = result.stdout.trim().length > 0;
    return this.availableCache;
  }

  async detect(): Promise<GpuInfo[]> {
    const psScript = [
      "Get-CimInstance -ClassName Win32_VideoController |",
      "  ForEach-Object {",
      "    @{",
      "      name = $_.Name",
      "      vram = $_.AdapterRAM",
      "      pci  = $_.PNPDeviceID",
      "    }",
      "  } | ConvertTo-Json",
    ].join("\n");

    const result = await safeExec(psScript, { timeout: 15000 });
    if (!result.stdout.trim()) return [];

    return this.parseJson(result.stdout);
  }

  private parseJson(raw: string): GpuInfo[] {
    try {
      const items: unknown[] = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [JSON.parse(raw)];

      return items.map((item, idx) => {
        const data = item as Record<string, unknown>;
        const name = (data.name as string) ?? "Unknown GPU";
        const vramBytes = parseInt((data.vram as string) ?? (data.AdapterRAM as string) ?? "0", 10);

        return {
          index: idx,
          vendor: classifyVendor(name),
          brand: resolveBrand(name),
          name,
          vulkanName: "",
          vramTotal: Math.round(vramBytes / (1024 * 1024 * 1024)),
          vramUsed: 0,
          usage: 0,
          temperature: 0,
          pciBusId: (data.pci as string) ?? (data.PNPDeviceID as string) ?? "",
        };
      });
    } catch {
      return [];
    }
  }
}

function classifyVendor(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("NVIDIA")) return "NVIDIA";
  if (upper.includes("AMD") || upper.includes("RADEON")) return "AMD";
  if (upper.includes("INTEL")) return "Intel";
  return "Unknown";
}

function resolveBrand(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("AMD") || upper.includes("RADEON")) return "RADEON";
  return classifyVendor(name);
}
