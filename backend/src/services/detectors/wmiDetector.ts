import { injectable } from "inversify";
import * as path from "path";
import { GpuInfo } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuDetector } from "./gpuDetector";

/**
 * Detect GPUs on Windows using PowerShell WMI (Win32_VideoController).
 * Supports all vendors — NVIDIA, AMD, Intel.
 * PCI bus ID is read from the Windows registry (LocationInformation) to match
 * the format produced by nvidia-smi (e.g. "01:00.0"), enabling correct dedup.
 */
@injectable()
export class WmiDetector implements GpuDetector {
  private readonly scriptPath = path.resolve(__dirname, "../../../files/wmiGpuQuery.ps1");
  private availableCache: boolean | null = null;

  constructor() {
    if (process.platform !== "win32") {
      this.availableCache = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.availableCache !== null) return this.availableCache;

    const result = await ExecTools.safeExec(
      "Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1 | ConvertTo-Json",
      { timeout: 8000 },
    );
    const available = result.stdout.trim().length > 0;
    if (available) {
      this.availableCache = true;
    }
    return available;
  }

  async detect(): Promise<GpuInfo[]> {
    const result = await ExecTools.safeExecPs1(this.scriptPath, { timeout: 15000 });
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
          engineCudaName: "",
          engineRocmName: "",
          engineVulkanName: "",
          vramTotal: Math.round(vramBytes / (1024 * 1024 * 1024)),
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
