import { exec as execCallback } from "child_process";
import { promisify } from "util";
import { GpuInfo } from "../types";

const exec = promisify(execCallback);

function safeExec(command: string, opts?: { timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return exec(command, {
    timeout: opts?.timeout ?? 10000,
    maxBuffer: 1024 * 1024,
    shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
  }).catch((err) => ({ stdout: "", stderr: err.message }));
}

/* ------------------------------------------------------------------ */
/*  NVIDIA                                                            */
/* ------------------------------------------------------------------ */

async function detectNvidia(): Promise<GpuInfo[]> {
  const result = await safeExec(
    'nvidia-smi --query-gpu=index,name,vbios_version,memory.total,memory.used,utilization.gpu,temperature.gpu,pci.bus_id --format=csv,noheader,nounits',
    { timeout: 10000 }
  );

  if (result.stderr && !result.stdout) return [];

  const lines = result.stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const gpus: GpuInfo[] = [];

  for (const line of lines) {
    // nvidia-smi CSV: "0, NVIDIA GeForce RTX 4090, 96.0.88.0.0f, 24564, 2048, 12, 45, 00000000:0B:00.0"
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length < 8) continue;

    const name = parts[1];
    const vramTotalMiB = parseFloat(parts[3]);
    const vramUsedMiB = parseFloat(parts[4]);
    const usage = parseFloat(parts[5]);
    const temperature = parseFloat(parts[6]);
    const pciBusId = parts[7];

    gpus.push({
      index: parseInt(parts[0], 10),
      vendor: "NVIDIA",
      brand: "NVIDIA",
      name,
      vulkanName: name,
      vramTotal: Math.round(vramTotalMiB / 1024),
      vramUsed: Math.round(vramUsedMiB / 1024),
      usage: isNaN(usage) ? 0 : usage,
      temperature: isNaN(temperature) ? 0 : temperature,
      pciBusId,
    });
  }

  return gpus;
}

/* ------------------------------------------------------------------ */
/*  AMD (Linux — rocm-smi)                                            */
/* ------------------------------------------------------------------ */

async function detectAmdLinux(): Promise<GpuInfo[]> {
  const nameResult = await safeExec("rocm-smi --showproductname --json", { timeout: 10000 });
  const tempResult = await safeExec("rocm-smi --showtemperature --json", { timeout: 10000 });
  const usageResult = await safeExec("rocm-smi --showusage --json", { timeout: 10000 });
  const vramResult = await safeExec("rocm-smi --showmemusage --json", { timeout: 10000 });

  if (nameResult.stderr && !nameResult.stdout) return [];

  const gpus: GpuInfo[] = [];
  let count = 0;

  try {
    const nameData = JSON.parse(nameResult.stdout);
    count = nameData.card_count ?? 0;
  } catch {
    return [];
  }

  for (let i = 0; i < count; i++) {
    let name = `AMD GPU ${i}`;
    let temperature = 0;
    let usage = 0;
    let vramUsed = 0;
    let vramTotal = 0;

    try {
      const nameData = JSON.parse(nameResult.stdout);
      name = nameData.card_product_name?.[i] ?? name;
    } catch { /* keep default */ }

    try {
      const tempData = JSON.parse(tempResult.stdout);
      temperature = tempData.card_temperature?.[i] ?? 0;
    } catch { /* keep default */ }

    try {
      const usageData = JSON.parse(usageResult.stdout);
      usage = usageData.gpu_usage_percent?.[i] ?? 0;
    } catch { /* keep default */ }

    try {
      const vramData = JSON.parse(vramResult.stdout);
      vramUsed = Math.round((vramData.used_memory_vif_block_percent?.[i] ?? 0) / 100 * vramTotal);
    } catch { /* keep default */ }

    gpus.push({
      index: i,
      vendor: "AMD",
      brand: "RADEON",
      name,
      vulkanName: name,
      vramTotal,
      vramUsed,
      usage,
      temperature,
      pciBusId: "",
    });
  }

  return gpus;
}

/* ------------------------------------------------------------------ */
/*  AMD (Windows — PowerShell WMI)                                    */
/* ------------------------------------------------------------------ */

async function detectAmdWindows(): Promise<GpuInfo[]> {
  const psScript = `
    Get-CimInstance -ClassName Win32_VideoController | Where-Object { $_.Name -match 'AMD|RADEON|Radeon' } | ` +
    `ForEach-Object { @{index=0; name=$_.Name; vram=$_.AdapterRAM; pci=$_.PNPDeviceID} } | ConvertTo-Json
  `;

  const result = await safeExec(psScript, { timeout: 15000 });
  if (result.stderr && !result.stdout) return [];

  const gpus: GpuInfo[] = [];
  let idx = 0;

  try {
    const data = JSON.parse(result.stdout);
    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      const vramBytes = parseInt(item.vram ?? item.AdapterRAM ?? "0", 10);
      gpus.push({
        index: idx++,
        vendor: "AMD",
        brand: "RADEON",
        name: item.name ?? `AMD GPU ${idx - 1}`,
        vulkanName: "",
        vramTotal: Math.round(vramBytes / (1024 * 1024 * 1024)),
        vramUsed: 0,
        usage: 0,
        temperature: 0,
        pciBusId: item.pci ?? item.PNPDeviceID ?? "",
      });
    }
  } catch {
    // parse error — return empty
  }

  return gpus;
}

/* ------------------------------------------------------------------ */
/*  Vulkan names (Linux — vulkaninfo)                                 */
/* ------------------------------------------------------------------ */

async function getVulkanNames(): Promise<Record<number, string>> {
  if (process.platform !== "linux") return {};

  const result = await safeExec(
    "vulkaninfo --summary 2>/dev/null | grep -E 'deviceName|deviceType' | paste - - ",
    { timeout: 10000 }
  );

  if (result.stderr && !result.stdout) return {};

  const map: Record<number, string> = {};
  const lines = result.stdout.trim().split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/deviceName\s+=\s+(.+)/);
    if (match) {
      map[i] = match[1].trim();
    }
  }

  return map;
}

/* ------------------------------------------------------------------ */
/*  PCI vendor enrichment (Linux — lspci)                             */
/* ------------------------------------------------------------------ */

async function getLspciBrands(): Promise<Record<string, string>> {
  if (process.platform !== "linux") return {};

  const result = await safeExec(
    "lspci -vnn | grep -A 3 -E 'VGA|3D|Display'",
    { timeout: 10000 }
  );

  if (result.stderr && !result.stdout) return {};

  const map: Record<string, string> = {};
  const blocks = result.stdout.split("\n\n");

  for (const block of blocks) {
    const pciMatch = block.match(/^([0-9a-fA-F]{2}):([0-9a-fA-F]{2}):([0-9a-fA-F]{2})\.([0-9])/);
    if (!pciMatch) continue;

    const busId = `${pciMatch[1]}:${pciMatch[2]}:${pciMatch[3]}.${pciMatch[4]}`.toUpperCase();
    const brand = detectBrandFromPci(block);
    if (brand) map[busId] = brand;
  }

  return map;
}

function detectBrandFromPci(block: string): string {
  const upper = block.toUpperCase();
  if (upper.includes("ASROK") || upper.includes("ASROCK")) return "ASROCK";
  if (upper.includes("MSI ")) return "MSI";
  if (upper.includes("GIGABYTE")) return "GIGABYTE";
  if (upper.includes("EVGA")) return "EVGA";
  if (upper.includes("ZOTAC")) return "ZOTAC";
  if (upper.includes("SAPPHIRE")) return "SAPPHIRE";
  if (upper.includes("POWERCOLOR")) return "POWERCOLOR";
  if (upper.includes("XFX")) return "XFX";
  if (upper.includes("SAPPHIRE")) return "SAPPHIRE";
  return "";
}

/* ------------------------------------------------------------------ */
/*  Windows WMI fallback (all GPUs)                                   */
/* ------------------------------------------------------------------ */

async function detectWindowsWmi(): Promise<GpuInfo[]> {
  const psScript = `
    Get-CimInstance -ClassName Win32_VideoController | ` +
    `ForEach-Object { ` +
    `  @{ name=$_.Name; vram=$_.AdapterRAM; pci=$_.PNPDeviceID; status=$_.Status } ` +
    `} | ConvertTo-Json
  `;

  const result = await safeExec(psScript, { timeout: 15000 });
  if (result.stderr && !result.stdout) return [];

  const gpus: GpuInfo[] = [];
  let idx = 0;

  try {
    const data = JSON.parse(result.stdout);
    const items = Array.isArray(data) ? data : [data];

    for (const item of items) {
      const name = item.name ?? "Unknown GPU";
      const vramBytes = parseInt(item.vram ?? item.AdapterRAM ?? "0", 10);
      const vendor = name.toUpperCase().includes("NVIDIA")
        ? "NVIDIA"
        : name.toUpperCase().includes("AMD") || name.toUpperCase().includes("RADEON")
        ? "AMD"
        : name.toUpperCase().includes("INTEL")
        ? "Intel"
        : "Unknown";

      gpus.push({
        index: idx++,
        vendor,
        brand: vendor === "AMD" ? "RADEON" : vendor,
        name,
        vulkanName: "",
        vramTotal: Math.round(vramBytes / (1024 * 1024 * 1024)),
        vramUsed: 0,
        usage: 0,
        temperature: 0,
        pciBusId: item.pci ?? item.PNPDeviceID ?? "",
      });
    }
  } catch {
    // parse error
  }

  return gpus;
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export async function getGpuList(): Promise<GpuInfo[]> {
  const isWindows = process.platform === "win32";
  let gpus: GpuInfo[] = [];

  if (isWindows) {
    // On Windows: try nvidia-smi first, then WMI fallback
    const nvidia = await detectNvidia();
    if (nvidia.length > 0) {
      gpus.push(...nvidia);
    }

    // WMI fallback for any non-detected GPUs
    const wmi = await detectWindowsWmi();
    const nvidiaNames = new Set(nvidia.map((g) => g.name));
    for (const gpu of wmi) {
      if (!nvidiaNames.has(gpu.name)) {
        gpus.push(gpu);
      }
    }
  } else {
    // On Linux: nvidia-smi + rocm-smi
    const nvidia = await detectNvidia();
    const amd = await detectAmdLinux();
    gpus = [...nvidia, ...amd];

    // Enrich with lspci brands and vulkan names
    if (gpus.length > 0) {
      const [brands, vulkanNames] = await Promise.all([
        getLspciBrands(),
        getVulkanNames(),
      ]);

      for (const gpu of gpus) {
        if (brands[gpu.pciBusId.toUpperCase()]) {
          gpu.brand = brands[gpu.pciBusId.toUpperCase()];
        }
        if (vulkanNames[gpu.index]) {
          gpu.vulkanName = vulkanNames[gpu.index];
        }
      }
    }
  }

  return gpus;
}
