import { readdir, stat } from "fs/promises";
import { join, dirname, sep } from "path";
import { GpuService } from "./gpuService";

/** One autocomplete suggestion entry. */
export interface AutocompleteSuggestion {
  /** Full path to suggest. */
  path: string;
  /** Human-readable source label. */
  source: string;
}

export type AutocompleteType = "binary" | "model" | "mmproj" | "apikey" | "host" | "device";

const WIN_HOME = process.env.USERPROFILE ?? "";
const WIN_LOCAL = process.env.LOCALAPPDATA ?? "";
const LINUX_HOME = process.env.HOME ?? "";

const WIN_BINARY_DIRS: string[] = [
  join(WIN_HOME, "llama.cpp"),
  join(WIN_HOME, "llama.cpp", "build", "bin"),
  join(WIN_LOCAL, "Programs", "llama.cpp"),
  "C:\\Program Files\\llama.cpp",
  "C:\\Program Files (x86)\\llama.cpp",
].filter((p): p is string => Boolean(p));

const LINUX_BINARY_DIRS: string[] = [
  "/usr/local/bin",
  "/usr/bin",
  "/opt/llama.cpp",
  join(LINUX_HOME, "llama.cpp"),
].filter((p): p is string => Boolean(p));

const WIN_MODEL_DIRS: string[] = [
  join(WIN_HOME, "models"),
  join(WIN_HOME, "AI", "models"),
  join(WIN_HOME, ".cache", "huggingface"),
].filter((p): p is string => Boolean(p));

const LINUX_MODEL_DIRS: string[] = [
  join(LINUX_HOME, "models"),
  join(LINUX_HOME, ".local", "share", "models"),
  join(LINUX_HOME, ".cache", "huggingface"),
  process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, "models") : null,
  "/opt/models",
  "/usr/share/models",
].filter((p): p is string => Boolean(p));

/**
 * Search given directories for matching files.
 */
async function searchDirs(dirs: string[], ext?: string, query?: string): Promise<AutocompleteSuggestion[]> {
  const results: AutocompleteSuggestion[] = [];

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const fullPath = join(dir, entry);
        try {
          const s = await stat(fullPath);
          if (s.isDirectory()) continue;
        } catch {
          continue;
        }
        if (ext && !entry.toLowerCase().endsWith(ext)) continue;
        if (query && !entry.toLowerCase().includes(query)) continue;
        if (!ext) {
          // Binary search — filter by platform
          if (process.platform === "win32") {
            if (!entry.toLowerCase().endsWith(".exe")) continue;
          } else {
            // Linux: skip known non-binary extensions
            const skipExt = [
              ".txt",
              ".md",
              ".log",
              ".cfg",
              ".conf",
              ".ini",
              ".json",
              ".xml",
              ".yaml",
              ".yml",
              ".py",
              ".sh",
            ];
            if (skipExt.some((e) => entry.toLowerCase().endsWith(e))) continue;
          }
        }
        results.push({ path: fullPath, source: dir });
      }
    } catch {
      // directory doesn't exist or can't be read
    }
  }

  // Deduplicate by basename
  const seen = new Set<string>();
  return results.filter((s) => {
    const key = s.path.split(sep).pop() ?? s.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Extract unique directories from existing config paths.
 */
function extractDirsFromConfigs(configs: { command?: string; flags?: string[] }[]): string[] {
  const dirs = new Set<string>();

  for (const cfg of configs) {
    // Directories from command paths
    if (cfg.command) {
      const cmdDir = dirname(cfg.command);
      if (cmdDir) dirs.add(cmdDir);
    }
    // Directories from --model, --mmproj, --api-key-file flags in the flags array
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

/**
 * Get list of network interface IPs (excluding loopback for host suggestions).
 */
function getNetworkHosts(): { includeLoopback: string[]; all: string[] } {
  const os = require("os");
  const ips = new Set<string>();
  const allIps = new Set<string>();

  const ifaces = os.networkInterfaces() as Record<
    string,
    Array<{ family: string; address: string; internal: boolean }> | undefined
  >;
  for (const _addrs of Object.values(ifaces)) {
    if (!_addrs) continue;
    for (const addr of _addrs) {
      if (addr.family === "IPv4") {
        allIps.add(addr.address);
        if (!addr.internal) {
          ips.add(addr.address);
        }
      }
    }
  }

  return {
    includeLoopback: [...new Set([...ips, "127.0.0.1"])],
    all: [...allIps],
  };
}

/**
 * Resolve device names from GPU static info.
 */
function getDeviceNamesFromGpu(gpuService: GpuService | null): string[] {
  if (!gpuService) return [];

  const devices: string[] = [];
  // Use cached GPUs if available (synchronous access)
  const cachedGpus = (gpuService as any).cachedGpus;
  if (!cachedGpus) return [];

  for (const gpu of cachedGpus) {
    if (gpu.engineCudaName) devices.push(gpu.engineCudaName);
    if (gpu.engineRocmName) devices.push(gpu.engineRocmName);
    if (gpu.engineVulkanName) devices.push(gpu.engineVulkanName);
  }

  return devices;
}

export class LlamaAutocompleteService {
  private gpuService: GpuService | null = null;

  /** Set GPU service reference lazily (avoids circular deps). */
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
    const lowerQuery = query.toLowerCase().trim();

    switch (type) {
      case "binary":
        return this.suggestBinary(lowerQuery, allConfigs);
      case "model":
      case "mmproj":
        return this.suggestModel(lowerQuery, allConfigs);
      case "apikey":
        return this.suggestApikey(lowerQuery, allConfigs);
      case "host":
        return this.suggestHost(lowerQuery);
      case "device":
        return this.suggestDevice(lowerQuery);
      default:
        return [];
    }
  }

  private async suggestBinary(
    query: string,
    allConfigs: { command?: string; flags?: string[] }[],
  ): Promise<AutocompleteSuggestion[]> {
    const configDirs = extractDirsFromConfigs(allConfigs);
    const commonDirs = process.platform === "win32" ? WIN_BINARY_DIRS : LINUX_BINARY_DIRS;
    const searchDirsList = [...new Set([...commonDirs, ...configDirs])];

    const dirs = await searchDirs(searchDirsList, undefined, query || undefined);

    // Also add existing commands from configs
    const configEntries: AutocompleteSuggestion[] = [];
    const seen = new Set<string>();
    for (const cfg of allConfigs) {
      if (cfg.command && !seen.has(cfg.command)) {
        seen.add(cfg.command);
        if (!query || cfg.command.toLowerCase().includes(query)) {
          configEntries.push({ path: cfg.command, source: "existing config" });
        }
      }
    }

    return [...configEntries, ...dirs];
  }

  private async suggestModel(
    query: string,
    allConfigs: { command?: string; flags?: string[] }[],
  ): Promise<AutocompleteSuggestion[]> {
    const configDirs = extractDirsFromConfigs(allConfigs);
    const commonDirs = process.platform === "win32" ? WIN_MODEL_DIRS : LINUX_MODEL_DIRS;
    const searchDirsList = [...new Set([...commonDirs, ...configDirs])];

    // Search recursively for .gguf files (go 2 levels deep)
    const results: AutocompleteSuggestion[] = [];

    for (const dir of searchDirsList) {
      try {
        const entries = await readdir(dir);
        for (const entry of entries) {
          if (entry.startsWith(".")) continue;
          const fullPath = join(dir, entry);
          try {
            const s = await stat(fullPath);
            if (s.isFile()) {
              if (!entry.toLowerCase().endsWith(".gguf")) continue;
              if (query && !entry.toLowerCase().includes(query)) continue;
              results.push({ path: fullPath, source: dir });
            } else if (s.isDirectory()) {
              // One level deeper
              try {
                const subEntries = await readdir(fullPath);
                for (const sub of subEntries) {
                  if (sub.startsWith(".")) continue;
                  const subPath = join(fullPath, sub);
                  try {
                    const subStat = await stat(subPath);
                    if (subStat.isFile() && sub.toLowerCase().endsWith(".gguf")) {
                      if (!query || sub.toLowerCase().includes(query)) {
                        results.push({ path: subPath, source: dirname(subPath) });
                      }
                    }
                  } catch {
                    // skip
                  }
                }
              } catch {
                // skip
              }
            }
          } catch {
            continue;
          }
        }
      } catch {
        // directory doesn't exist
      }
    }

    return results;
  }

  private async suggestApikey(
    query: string,
    allConfigs: { command?: string; flags?: string[] }[],
  ): Promise<AutocompleteSuggestion[]> {
    const configDirs = extractDirsFromConfigs(allConfigs);

    const commonDirs: string[] =
      process.platform === "win32"
        ? [join(WIN_HOME, ".config"), join(WIN_HOME, ".llama")]
        : [join(LINUX_HOME, ".config"), join(LINUX_HOME, ".llama"), "/etc"];

    const searchDirsList = [...new Set([...commonDirs, ...configDirs])];

    return searchDirs(searchDirsList, ".ini", query || undefined);
  }

  private suggestHost(query: string): AutocompleteSuggestion[] {
    const hosts = ["0.0.0.0", "127.0.0.1"];
    const hostsWithLoopback = getNetworkHosts().includeLoopback;

    const all = [...new Set([...hosts, ...hostsWithLoopback])];
    const filtered = query ? all.filter((h) => h.includes(query)) : all;

    return filtered.map((ip) => ({
      path: ip,
      source: ip === "0.0.0.0" ? "all interfaces" : ip === "127.0.0.1" ? "localhost" : "network interface",
    }));
  }

  private suggestDevice(query: string): AutocompleteSuggestion[] {
    const devices = getDeviceNamesFromGpu(this.gpuService);
    const filtered = query ? devices.filter((d) => d.toLowerCase().includes(query)) : devices;

    return filtered.map((d) => ({ path: d, source: "GPU device" }));
  }
}
