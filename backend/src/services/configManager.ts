import * as fs from "fs";
import * as path from "path";
import { ServiceConfig, parseConfigFile, serializeConfig } from "../models/ServiceConfig";

const CONFIG_DIR = path.join(process.env.HOME ?? "", ".config", "aiservermanager", "services");

/**
 * Manages service config files in ~/.config/aiservermanager/services/*.conf
 */
export class ConfigManager {
  /** Ensure the config directory exists. */
  private ensureDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  /** Get the absolute path for a suffix's config file. */
  private configPath(suffix: string): string {
    return path.join(CONFIG_DIR, `${suffix}.conf`);
  }

  /** List all service configs. */
  list(): ServiceConfig[] {
    this.ensureDir();
    const entries = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".conf"));

    const configs: ServiceConfig[] = [];
    for (const entry of entries) {
      const suffix = entry.replace(/\.conf$/, "");
      const raw = fs.readFileSync(this.configPath(suffix), "utf-8");
      try {
        configs.push(parseConfigFile(suffix, raw));
      } catch {
        // Skip unparseable configs
      }
    }
    return configs.sort((a, b) => a.suffix.localeCompare(b.suffix));
  }

  /** Get a single service config by suffix. */
  get(suffix: string): ServiceConfig | null {
    const p = this.configPath(suffix);
    if (!fs.existsSync(p)) return null;
    return parseConfigFile(suffix, fs.readFileSync(p, "utf-8"));
  }

  /** Save (create or update) a service config. */
  save(cfg: ServiceConfig): void {
    this.ensureDir();
    fs.writeFileSync(this.configPath(cfg.suffix), serializeConfig(cfg), "utf-8");
  }

  /** Delete a service config file. Returns true if the file existed. */
  delete(suffix: string): boolean {
    const p = this.configPath(suffix);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
    return false;
  }
}
