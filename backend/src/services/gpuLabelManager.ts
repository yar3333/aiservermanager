import * as fs from "fs";
import * as path from "path";
import { injectable, unmanaged } from "inversify";

const DEFAULT_CONFIG_PATH = path.join(
  process.env.HOME ?? "",
  ".config",
  "aiservermanager",
  "gpu-label.conf",
);

/**
 * Manages user-defined GPU labels in ~/.config/aiservermanager/gpu-label.conf.
 * One line per GPU, keyed by PCI bus id: `<pciBusId>=<text>`
 * Empty lines and lines starting with `#` are ignored.
 */
@injectable()
export class GpuLabelManager {
  private readonly configPath: string;

  constructor(@unmanaged() configPath?: string) {
    this.configPath = configPath ?? DEFAULT_CONFIG_PATH;
  }

  /** Read all entries: pciBusId → gpu label text. */
  getAll(): Record<string, string> {
    if (!fs.existsSync(this.configPath)) return {};

    const raw = fs.readFileSync(this.configPath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      if (!key) continue;
      result[key] = trimmed.slice(eqIdx + 1).trim();
    }
    return result;
  }

  /** Upsert one GPU's label. Pass empty string to remove the entry. */
  set(pciBusId: string, gpuLabel: string): void {
    const entries = this.getAll();
    const value = gpuLabel.trim();
    if (value) {
      entries[pciBusId] = value;
    } else {
      delete entries[pciBusId];
    }
    this.writeAll(entries);
  }

  private writeAll(entries: Record<string, string>): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const lines = Object.entries(entries)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);
    fs.writeFileSync(this.configPath, lines.length ? lines.join("\n") + "\n" : "", "utf-8");
  }
}