import * as fs from "fs";
import { injectable } from "inversify";
import { GpuInfo } from "../../models/GpuInfo";
import { ExecTools } from "../../helpers/ExecTools";
import { GpuIndexResolver } from "./gpuIndexResolver";

/**
 * Lists DRM cards that own a render node, with their PCI address:
 *
 *   card1 0000:c3:00.0
 *   card2 0000:c6:00.0
 *
 * Vendor-agnostic: works for any GPU with a DRM render node (AMD, NVIDIA, ...).
 * - Connector entries (card1-DP-1) resolve to the drm card dir, not a PCI
 *   device, so they fail the render-node check below.
 * - BMC/iGPU cards without a render node (e.g. ASPEED VGA) are skipped.
 * - Card numbers are assigned by the kernel in device probe order — the same
 *   order KFD registers its agents — so card order == HIP order.
 *
 * Linux only.
 */
const LIST_RENDER_CARDS = `
for c in /sys/class/drm/card[0-9]*; do
  d=$(readlink -f "$c/device" 2>/dev/null) || continue
  ls "$d"/drm/renderD* >/dev/null 2>&1 || continue
  printf '%s %s\\n' "$(basename "$c")" "$(basename "$d")"
done
`;

@injectable()
export class SysfsRenderIndexResolver implements GpuIndexResolver {
  async isAvailable(): Promise<boolean> {
    return process.platform === "linux" && fs.existsSync("/sys/class/drm");
  }

  async resolve(gpus: GpuInfo[]): Promise<number> {
    if (gpus.length === 0) return 0;

    const result = await ExecTools.safeExec(LIST_RENDER_CARDS, { timeout: 5000 });
    if (!result.stdout.trim()) return 0;

    const byPci = new Map<string, GpuInfo>();
    for (const gpu of gpus) {
      if (gpu.pciBusId) byPci.set(normalizePci(gpu.pciBusId), gpu);
    }

    let index = 0;
    for (const { pci } of this.parseLines(result.stdout)) {
      const gpu = byPci.get(normalizePci(pci));
      if (!gpu) continue; // render card not in the detected list (iGPU, etc.)
      gpu.gpuIndex = index++;
    }

    return index;
  }

  /** "cardN <pci>" lines, sorted by numeric card number (probe order). */
  private parseLines(raw: string): { card: number; pci: string }[] {
    const cards: { card: number; pci: string }[] = [];

    for (const line of raw.trim().split("\n")) {
      const [name, pci] = line.split(/\s+/);
      const card = parseInt((name ?? "").replace("card", ""), 10);
      if (name === undefined || pci === undefined || Number.isNaN(card)) continue;
      cards.push({ card, pci });
    }

    return cards.sort((a, b) => a.card - b.card);
  }
}

/** "0000:c3:00.0" → "C3:00.0" — strip domain prefix, uppercase (detector format). */
function normalizePci(raw: string): string {
  return raw.trim().toUpperCase().replace(/^0+:/, "");
}
