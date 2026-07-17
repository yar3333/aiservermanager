import { readdir, stat } from "fs/promises";
import { join, dirname, sep } from "path";
import { GpuService } from "./gpuService";

/** One autocomplete suggestion entry. */
export interface AutocompleteSuggestion {
  path: string;
  source: string;
  isDir?: boolean;
}

export type AutocompleteType = "binary" | "model" | "mmproj" | "apikey" | "host" | "device" | "path";

const WIN_HOME = process.env.USERPROFILE ?? "";
const LINUX_HOME = process.env.HOME ?? "";

/**
 * Real filesystem path completion — shell-style.
 * 1) If query itself is an existing directory → list its contents.
 * 2) Split into parent dir + prefix → list matching entries in parent.
 * 3) No separator → search known root directories.
 */
async function searchPaths(query: string): Promise<AutocompleteSuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const normalized = trimmed.replace(/\//g, sep);

  // 1) If the query itself is an existing directory → list contents
  try {
    const s = await stat(normalized);
    if (s.isDirectory()) {
      return listDirMatches(normalized + sep, "");
    }
  } catch {
    // not a directory, continue
  }

  // 2) Split into parent dir + prefix
  const lastSepIdx = normalized.lastIndexOf(sep);

  if (lastSepIdx >= 0) {
    const parentDir = normalized.slice(0, lastSepIdx + 1);
    const prefix = normalized.slice(lastSepIdx + 1);

    // If prefix is non-empty and query-as-dir doesn't exist (checked above),
    // also try treating the query as a directory name in the parent
    const results = await listDirMatches(parentDir, prefix);

    // If no matches and prefix is non-empty, try listing the parent and showing dirs matching prefix
    if (results.length === 0 && prefix) {
      // parent might not exist or be unreadable — try one level up
      const grandParentSepIdx = parentDir.lastIndexOf(sep);
      if (grandParentSepIdx >= 0) {
        const grandParentDir = parentDir.slice(0, grandParentSepIdx + 1);
        const parentPrefix = parentDir.slice(grandParentSepIdx + 1);
        return listDirMatches(grandParentDir, parentPrefix);
      }
    }

    return results;
  }

  if (process.platform === "win32" && normalized.match(/^[A-Za-z]:/)) {
    // "C:foo" → parent "C:\", prefix "foo"
    return listDirMatches(normalized[0] + ":" + sep, normalized.slice(2));
  }

  // 3) No separator — search known root directories
  const roots = getSearchRoots();
  const results: AutocompleteSuggestion[] = [];
  for (const root of roots) {
    results.push(...(await listDirMatches(root, normalized)));
  }
  return results.slice(0, 50);
}

async function listDirMatches(parentDir: string, prefix: string): Promise<AutocompleteSuggestion[]> {
  try {
    const entries = await readdir(parentDir);
    const results: AutocompleteSuggestion[] = [];
    for (const entry of entries) {
      if (entry.toLowerCase().startsWith(prefix.toLowerCase())) {
        const fullPath = join(parentDir, entry);
        try {
          const s = await stat(fullPath);
          results.push({ path: fullPath, source: parentDir, isDir: s.isDirectory() });
        } catch {
          results.push({ path: fullPath, source: parentDir });
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

function getSearchRoots(): string[] {
  if (process.platform === "win32") {
    return [WIN_HOME, "C:\\", "D:\\", join("C:", "Program Files"), join("C:", "Program Files (x86)")].filter(Boolean);
  }
  return ["/", LINUX_HOME, "/opt", "/usr", "/home"];
}

/** Extract unique directories from existing config paths (used to seed root dirs). */
function extractDirsFromConfigs(configs: { command?: string; flags?: string[] }[]): string[] {
  const dirs = new Set<string>();
  for (const cfg of configs) {
    if (cfg.command) {
      const cmdDir = dirname(cfg.command);
      if (cmdDir) dirs.add(cmdDir);
    }
    if (cfg.flags) {
      for (let i = 0; i < cfg.flags.length; i++) {
        if (
          ["--model", "--mmproj", "--api-key-file", "--model-draft"].includes(cfg.flags[i]) &&
          i + 1 < cfg.flags.length
        ) {
          const flagDir = dirname(cfg.flags[i + 1]);
          if (flagDir) dirs.add(flagDir);
        }
      }
    }
  }
  return [...dirs];
}

/** Get list of network interface IPs. */
function getNetworkHosts(): string[] {
  const os = require("os");
  const ips = new Set<string>();
  const ifaces = os.networkInterfaces() as Record<
    string,
    Array<{ family: string; address: string; internal: boolean }> | undefined
  >;
  for (const _addrs of Object.values(ifaces)) {
    if (!_addrs) continue;
    for (const addr of _addrs) {
      if (addr.family === "IPv4" && !addr.internal) ips.add(addr.address);
    }
  }
  return [...new Set([...ips, "0.0.0.0", "127.0.0.1"])];
}

/** Resolve device names from GPU static info. */
function getDeviceNamesFromGpu(gpuService: GpuService | null): string[] {
  if (!gpuService) return [];
  const cachedGpus = (gpuService as any).cachedGpus;
  if (!cachedGpus) return [];
  const devices: string[] = [];
  for (const gpu of cachedGpus) {
    if (gpu.engineCudaName) devices.push(gpu.engineCudaName);
    if (gpu.engineRocmName) devices.push(gpu.engineRocmName);
    if (gpu.engineVulkanName) devices.push(gpu.engineVulkanName);
  }
  return devices;
}

export class LlamaAutocompleteService {
  private gpuService: GpuService | null = null;

  setGpuService(gpuService: GpuService): void {
    this.gpuService = gpuService;
  }

  /**
   * Get autocomplete suggestions for a given type and query.
   */
  async getSuggestions(
    type: AutocompleteType,
    query: string,
    allConfigs: { command?: string; flags?: string[] }[],
  ): Promise<AutocompleteSuggestion[]> {
    const trimmed = query.trim();
    const lowerQuery = trimmed.toLowerCase();

    switch (type) {
      case "path":
        return searchPaths(query);

      case "binary":
      case "model":
      case "mmproj":
      case "apikey":
        // All file-path fields use shell-style completion.
        // Also append config-based suggestions when the query is short (no path separator yet).
        const pathResults = await searchPaths(query);

        // When the user hasn't typed a path yet, also show values from existing configs
        if (!trimmed.includes(sep) && !trimmed.includes("/")) {
          const configPaths = this.extractConfigPaths(allConfigs, type);
          const seen = new Set(pathResults.map((r) => r.path));
          for (const cp of configPaths) {
            if (!seen.has(cp) && (!trimmed || cp.toLowerCase().includes(lowerQuery))) {
              pathResults.push({ path: cp, source: "existing config" });
            }
          }
        }
        return pathResults.slice(0, 50);

      case "host":
        return getNetworkHosts()
          .filter((h) => !trimmed || h.includes(lowerQuery))
          .map((ip) => ({
            path: ip,
            source: ip === "0.0.0.0" ? "all interfaces" : ip === "127.0.0.1" ? "localhost" : "network interface",
          }));

      case "device":
        const devices = getDeviceNamesFromGpu(this.gpuService);
        return devices
          .filter((d) => !trimmed || d.toLowerCase().includes(lowerQuery))
          .map((d) => ({ path: d, source: "GPU device" }));

      default:
        return [];
    }
  }

  /** Extract existing paths from configs for a given field type. */
  private extractConfigPaths(configs: { command?: string; flags?: string[] }[], type: AutocompleteType): string[] {
    const paths = new Set<string>();

    for (const cfg of configs) {
      switch (type) {
        case "binary":
          if (cfg.command) paths.add(cfg.command);
          break;
        case "model":
          if (cfg.flags) {
            const val = findFlag(cfg.flags, "--model");
            if (val) paths.add(val);
            const draft = findFlag(cfg.flags, "--model-draft");
            if (draft) paths.add(draft);
          }
          break;
        case "mmproj":
          if (cfg.flags) {
            const val = findFlag(cfg.flags, "--mmproj");
            if (val) paths.add(val);
          }
          break;
        case "apikey":
          if (cfg.flags) {
            const val = findFlag(cfg.flags, "--api-key-file");
            if (val) paths.add(val);
          }
          break;
      }
    }

    return [...paths];
  }
}

/** Extract value for a flag from the flags array. Handles "--flag value" and "--flag=value". */
function findFlag(flags: string[], name: string): string | null {
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === name && i + 1 < flags.length) return flags[i + 1];
    const eqIdx = flags[i].indexOf("=");
    if (eqIdx > 0 && flags[i].slice(0, eqIdx) === name) return flags[i].slice(eqIdx + 1);
  }
  return null;
}
