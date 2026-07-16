import * as fs from "fs";
import * as path from "path";

const CONFIG_DIR = path.join(process.env.HOME ?? "", ".config", "aiservermanager");
const MANAGED_FILE = path.join(CONFIG_DIR, "managed-services.json");

/**
 * Persists the user-selected list of managed service names.
 * Stored in ~/.config/aiservermanager/managed-services.json as a JSON array of strings.
 */
export class ManagedServicesManager {
  private ensureDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  /** Load the managed service names from disk. Returns [] if the file doesn't exist. */
  list(): string[] {
    if (!fs.existsSync(MANAGED_FILE)) return [];

    try {
      const raw = fs.readFileSync(MANAGED_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s: unknown): s is string => typeof s === "string" && s.trim() !== "");
    } catch {
      return [];
    }
  }

  /** Save the managed service names to disk. Deduplicates and sorts. */
  save(names: string[]): void {
    this.ensureDir();
    const deduped = [...new Set(names)].sort();
    fs.writeFileSync(MANAGED_FILE, JSON.stringify(deduped, null, 2) + "\n", "utf-8");
  }

  /** Add a service name to the managed list. Returns true if it was newly added. */
  add(name: string): boolean {
    const current = this.list();
    if (current.includes(name)) return false;
    this.save([...current, name]);
    return true;
  }

  /** Remove a service name from the managed list. Returns true if it was present. */
  remove(name: string): boolean {
    const current = this.list();
    const filtered = current.filter((s) => s !== name);
    if (filtered.length === current.length) return false;
    this.save(filtered);
    return true;
  }
}
