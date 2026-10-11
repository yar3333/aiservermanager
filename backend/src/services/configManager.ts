import * as fs from "fs";
import * as path from "path";
import { ServiceConfig, parseConfigFile, serializeConfig } from "../models/ServiceConfig";

const CONFIG_DIR = path.join(process.env.HOME ?? "", ".config", "aiservermanager", "services");
const ARCHIVE_DIR = path.join(process.env.HOME ?? "", ".config", "aiservermanager", "services-archive");

/**
 * Manages service config files in ~/.config/aiservermanager/services/*.conf
 * Each file is named <service-name>.conf and stores command + flags.
 * Archived configs are moved to ~/.config/aiservermanager/services-archive/.
 */
export class ConfigManager {
  /** Ensure the config directory exists. */
  private ensureDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  /** Ensure the archive directory exists. */
  private ensureArchiveDir(): void {
    if (!fs.existsSync(ARCHIVE_DIR)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
  }

  /** Get the absolute path for a service name's config file. */
  private configPath(name: string): string {
    return path.join(CONFIG_DIR, `${name}.conf`);
  }

  /** Get the absolute path for a service name's archived config file. */
  private archivePath(name: string): string {
    return path.join(ARCHIVE_DIR, `${name}.conf`);
  }

  /** List all service configs. */
  list(): ServiceConfig[] {
    this.ensureDir();
    const entries = fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".conf"));

    const configs: ServiceConfig[] = [];
    for (const entry of entries) {
      const name = entry.replace(/\.conf$/, "");
      const raw = fs.readFileSync(this.configPath(name), "utf-8");
      try {
        configs.push(parseConfigFile(name, raw));
      } catch {
        // Skip unparseable configs
      }
    }
    return configs.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Get a single service config by name. */
  get(name: string): ServiceConfig | null {
    const p = this.configPath(name);
    if (!fs.existsSync(p)) return null;
    return parseConfigFile(name, fs.readFileSync(p, "utf-8"));
  }

  /** Save (create or update) a service config. */
  save(cfg: ServiceConfig): void {
    this.ensureDir();
    fs.writeFileSync(this.configPath(cfg.name), serializeConfig(cfg), "utf-8");
  }

  /** Delete a service config file. Returns true if the file existed. */
  delete(name: string): boolean {
    const p = this.configPath(name);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
    return false;
  }

  /** List all archived service configs. */
  listArchived(): ServiceConfig[] {
    this.ensureArchiveDir();
    const entries = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".conf"));

    const configs: ServiceConfig[] = [];
    for (const entry of entries) {
      const name = entry.replace(/\.conf$/, "");
      const raw = fs.readFileSync(this.archivePath(name), "utf-8");
      try {
        configs.push(parseConfigFile(name, raw));
      } catch {
        // Skip unparseable configs
      }
    }
    return configs.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Move a service config file to the archive. Returns true if the file existed. */
  archive(name: string): boolean {
    const from = this.configPath(name);
    if (!fs.existsSync(from)) return false;
    this.ensureArchiveDir();
    fs.renameSync(from, this.archivePath(name));
    return true;
  }

  /** Move a service config file from the archive back to services. Returns true if the file existed. */
  restore(name: string): boolean {
    const from = this.archivePath(name);
    if (!fs.existsSync(from)) return false;
    this.ensureDir();
    fs.renameSync(from, this.configPath(name));
    return true;
  }
}
