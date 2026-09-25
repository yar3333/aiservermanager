import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { GpuIndexResolver } from "./gpuIndexResolver";

/**
 * Assigns gpuIndex by PCIe address (BDF) order: GPUs are sorted by the
 * numeric value of their PCI address (bus, then device, then function) and
 * each gets its position in that order — 0, 1, 2, ...
 *
 * This is the sequential number visible in `lspci` / `rocm-smi --showbus` —
 * deliberately NOT the kernel probe order (HIP/KFD agent order), which can
 * differ from BDF order (e.g. buses 83/86/C3/C6 probe as C3/C6/83/86).
 *
 * Platform-agnostic: every detector reports pciBusId as "BB:DD.F" (an
 * optional "DDDD:" domain prefix is accepted too). GPUs without a
 * parseable address are appended after the sorted ones, preserving detector
 * list order, so every GPU still gets a unique index.
 */
@injectable()
export class PciBusOrderIndexResolver implements GpuIndexResolver {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async resolve(gpus: GpuInfo[]): Promise<number> {
    if (gpus.length === 0) return 0;

    const withBus: { gpu: GpuInfo; value: number }[] = [];
    const withoutBus: GpuInfo[] = [];

    for (const gpu of gpus) {
      const value = parsePciBusId(gpu.pciBusId);
      if (value === null) {
        withoutBus.push(gpu);
      } else {
        withBus.push({ gpu, value });
      }
    }

    withBus.sort((a, b) => a.value - b.value);

    let index = 0;
    for (const { gpu } of withBus) {
      gpu.gpuIndex = index++;
    }
    for (const gpu of withoutBus) {
      gpu.gpuIndex = index++;
    }

    return gpus.length;
  }
}

/**
 * "BB:DD.F" (optionally "DDDD:BB:DD.F") → numeric BDF value, or null when
 * the string is not a PCI address. Case-insensitive.
 */
function parsePciBusId(raw: string): number | null {
  if (!raw) return null;

  const match = raw
    .trim()
    .toUpperCase()
    .match(/^(?:([0-9A-F]{1,4}):)?([0-9A-F]{1,2}):([0-9A-F]{1,2})\.([0-7])$/);
  if (!match) return null;

  const domain = match[1] ? parseInt(match[1], 16) : 0;
  const bus = parseInt(match[2], 16);
  const device = parseInt(match[3], 16);
  const func = parseInt(match[4], 16);

  return (domain << 16) | (bus << 8) | (device << 3) | func;
}
