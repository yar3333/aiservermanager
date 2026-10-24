import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ExecTools } from "../helpers/ExecTools";
import { HfDownload, HfLocalModel, HfStatus } from "../models/HfDownload";

type HfAction = "pause" | "resume" | "cancel";

interface ProcEntry {
  pid: number;
  /** Raw argv (NUL-separated cmdline entries). Matching must use these, not a joined string. */
  argv: string[];
  state: string;
  hfHome?: string;
}

interface ParsedArgs {
  repoId: string;
  localDir?: string;
  include: string[];
  exclude: string[];
  revision?: string;
  repoType?: string;
}

interface Group {
  key: string;
  repoId: string;
  repoType: string;
  revision: string;
  dest: string;
  pids: number[];
  states: string[];
  include: string[];
  exclude: string[];
  command: string;
}

interface SpeedState {
  lastBytes: number;
  lastTs: number;
  speed: number;
}

interface TreeFile {
  path: string;
  size: number;
}

const HF_API_BASE = "https://huggingface.co/api";
const REPO_TYPE_API: Record<string, string> = { model: "models", dataset: "datasets", space: "spaces" };
const REPO_TYPE_DIR: Record<string, string> = { model: "models", dataset: "datasets", space: "spaces" };
const SPEED_EMA_ALPHA = 0.3;

export class HfDownloadsService {
  private readonly procRoot: string;
  /** Override of the HF cache root (<HF_HOME>); resolved from env/HOME when absent. */
  private readonly cacheRootOverride?: string;
  private readonly speedMap = new Map<string, SpeedState>();

  constructor(procRoot = "/proc", cacheRootOverride?: string) {
    this.procRoot = procRoot;
    this.cacheRootOverride = cacheRootOverride;
  }

  /** Whether the `hf` CLI is available (Linux only). Works under systemd's minimal PATH. */
  async isInstalled(): Promise<HfStatus> {
    if (process.platform !== "linux") return { installed: false };
    const which = await ExecTools.safeExec("command -v hf", { env: { PATH: this.pathWithUserBins() } });
    const binPath = which.stdout.trim();
    if (binPath) {
      return this.hfStatusFor(binPath);
    }
    // Fallback: standard pipx/uv/pip --user install location (may not be on PATH at all)
    const candidate = path.join(os.homedir(), ".local", "bin", "hf");
    try {
      await fs.promises.access(candidate, fs.constants.X_OK);
    } catch {
      return { installed: false };
    }
    return this.hfStatusFor(candidate);
  }

  private async hfStatusFor(binPath: string): Promise<HfStatus> {
    const ver = await ExecTools.safeExec(`"${binPath}" version 2>/dev/null`);
    return { installed: true, version: ver.stdout.trim() || undefined };
  }

  /** PATH extended with common user-local bin dirs (systemd runs with a minimal PATH). */
  private pathWithUserBins(): string {
    const dirs = [
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), ".cargo", "bin"),
      "/opt/conda/bin",
      process.env.PATH ?? "",
    ];
    return [...new Set(dirs.map((d) => d.trim()).filter(Boolean))].join(":");
  }

  /** List all active `hf download` process groups with progress. */
  async listDownloads(): Promise<HfDownload[]> {
    if (process.platform !== "linux") return [];
    let groups = this.groupProcesses(this.scanProcesses());
    if (groups.length === 0 && this.speedMap.size > 0) {
      // Previous poll saw downloads — rescan once to ride out a transient /proc hiccup
      // instead of reporting "no downloads" for a single poll cycle.
      await new Promise((r) => setTimeout(r, 250));
      groups = this.groupProcesses(this.scanProcesses());
      if (groups.length === 0) {
        console.warn("[HfDownloadsService] /proc scan empty on retry, reporting no downloads");
      }
    }
    const downloads = await Promise.all(groups.map((g) => this.describeGroup(g)));
    const activeKeys = new Set(downloads.map((d) => `${d.repoId}|${d.dest}`));
    for (const key of this.speedMap.keys()) {
      if (!activeKeys.has(key)) this.speedMap.delete(key);
    }
    return downloads.sort((a, b) => a.repoId.localeCompare(b.repoId));
  }

  /**
   * Send a signal to every process of a download group.
   * pause → SIGSTOP, resume → SIGCONT, cancel → SIGTERM.
   */
  async sendAction(action: HfAction, repoId: string, dest: string): Promise<void> {
    if (process.platform !== "linux") throw new Error("HF downloads monitoring is only available on Linux");
    const procs = this.scanProcesses();
    const pids: number[] = [];
    for (const p of procs) {
      const args = this.parseArgs(p.argv);
      if (args.repoId !== repoId) continue;
      if (this.destinationFor(args, p.hfHome) !== dest) continue;
      pids.push(p.pid);
    }
    if (pids.length === 0) throw new Error(`No active download found for ${repoId}`);
    const signal = action === "pause" ? "SIGSTOP" : action === "resume" ? "SIGCONT" : "SIGTERM";
    let alive = false;
    for (const pid of pids) {
      try {
        process.kill(pid, signal);
        alive = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
      }
    }
    if (!alive) throw new Error(`No active download found for ${repoId}`);
    if (action !== "cancel") this.speedMap.delete(`${repoId}|${dest}`);
  }

  // ── local HF cache (downloaded models) ──

  /** <HF_HOME>/hub — where huggingface_hub stores <type>--org--name cache dirs. */
  private hubDir(): string {
    const root = this.cacheRootOverride || process.env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface");
    return path.join(root, "hub");
  }

  /** List models present in the local HF cache with their size on disk. */
  async listLocalModels(): Promise<HfLocalModel[]> {
    const hub = this.hubDir();
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(hub, { withFileTypes: true });
    } catch {
      return [];
    }
    const models: (HfLocalModel | null)[] = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && e.name.startsWith("models--"))
        .map(async (e) => {
          const name = HfDownloadsService.parseModelDirName(e.name);
          if (!name) return null;
          const dir = path.join(hub, e.name);
          return { name, dir, size: await this.dirSize(dir) };
        }),
    );
    return models.filter((m): m is HfLocalModel => m !== null).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Delete a model's cache directory. Name must be a plain "org/name" repo id. */
  async deleteLocalModel(name: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
      throw new Error(`Invalid model name: ${name}`);
    }
    const hub = this.hubDir();
    const dir = path.join(hub, `models--${name.replace("/", "--")}`);
    let real: string;
    try {
      real = await fs.promises.realpath(dir);
    } catch {
      throw new Error(`Model not found: ${name}`);
    }
    const hubReal = await fs.promises.realpath(hub).catch(() => null);
    if (hubReal && !real.startsWith(hubReal + path.sep)) {
      throw new Error("Invalid model path");
    }
    await fs.promises.rm(real, { recursive: true });
  }

  /** Total size of real files under dir. Symlinks are not followed, so the classic
   *  cache layout (snapshots/ symlinks → blobs/) is counted once. */
  private async dirSize(dir: string): Promise<number> {
    let total = 0;
    const walk = async (d: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        try {
          if (e.isDirectory()) await walk(path.join(d, e.name));
          else if (e.isFile()) total += (await fs.promises.lstat(path.join(d, e.name))).size;
        } catch {
          // file vanished mid-walk — ignore
        }
      }
    };
    await walk(dir);
    return total;
  }

  /** "models--org--name" → "org/name" (the name part may itself contain "--"). */
  private static parseModelDirName(baseName: string): string | null {
    const prefix = "models--";
    if (!baseName.startsWith(prefix)) return null;
    const rest = baseName.slice(prefix.length);
    const idx = rest.indexOf("--");
    if (idx <= 0) return null;
    return `${rest.slice(0, idx)}/${rest.slice(idx + 2)}`;
  }

  // ── process table ──

  private scanProcesses(): ProcEntry[] {
    const out: ProcEntry[] = [];
    let names: string[];
    try {
      names = fs.readdirSync(this.procRoot);
    } catch {
      return out;
    }
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const raw = fs.readFileSync(path.join(this.procRoot, name, "cmdline"), "utf8");
        const argv = raw.split("\0").filter(Boolean);
        if (!HfDownloadsService.isHfDownloadCmd(argv)) continue;
        const stat = fs.readFileSync(path.join(this.procRoot, name, "stat"), "utf8");
        const state = (stat.split(") ").pop() ?? "").charAt(0);
        let hfHome: string | undefined;
        try {
          const environ = fs.readFileSync(path.join(this.procRoot, name, "environ"), "utf8");
          hfHome = environ.split("\0").find((e) => e.startsWith("HF_HOME="))?.slice("HF_HOME=".length) || undefined;
        } catch {
          hfHome = undefined;
        }
        out.push({ pid: Number(name), argv, state, hfHome });
      } catch {
        // process exited or not readable — skip
      }
    }
    return out;
  }

  /** True when argv is a real `hf download` / `huggingface-cli download` invocation. */
  static isHfDownloadCmd(argv: string[]): boolean {
    return HfDownloadsService.findDownloadStart(argv) !== -1;
  }

  /**
   * Index of the first argument after `hf download` / `huggingface-cli download`, or -1.
   * Requires the CLI and the subcommand to be separate argv entries (basename of a path
   * counts: `/usr/local/bin/hf`). Text like `bash -c 'echo hf download x'` must NOT match —
   * there the whole script is a single argv element.
   */
  private static findDownloadStart(argv: string[]): number {
    for (let i = 0; i < argv.length - 1; i++) {
      const base = argv[i].split("/").pop() ?? argv[i];
      if ((base === "hf" || base === "huggingface-cli") && argv[i + 1] === "download") return i + 2;
    }
    return -1;
  }

  private parseArgs(argv: string[]): ParsedArgs {
    const start = HfDownloadsService.findDownloadStart(argv);
    if (start === -1) return { repoId: "", include: [], exclude: [] };
    const args: ParsedArgs = { repoId: argv[start], include: [], exclude: [] };
    for (let i = start + 1; i < argv.length; i++) {
      const t = argv[i];
      if (t === "--local-dir") args.localDir = argv[++i];
      else if (t === "--include") args.include.push(argv[++i]);
      else if (t === "--exclude") args.exclude.push(argv[++i]);
      else if (t === "--revision") args.revision = argv[++i];
      else if (t === "--repo-type") args.repoType = argv[++i];
    }
    return args;
  }

  private destinationFor(args: ParsedArgs, hfHome?: string): string {
    if (args.localDir) return path.resolve(args.localDir);
    const type = REPO_TYPE_DIR[args.repoType ?? "model"] ?? "models";
    const home = hfHome || path.join(os.homedir(), ".cache", "huggingface");
    return path.resolve(home, "hub", `${type}--${args.repoId.replace(/\//g, "--")}`);
  }

  private groupProcesses(procs: ProcEntry[]): Group[] {
    const groups = new Map<string, Group>();
    for (const p of procs) {
      const args = this.parseArgs(p.argv);
      if (!args.repoId) continue;
      const dest = this.destinationFor(args, p.hfHome);
      const key = `${args.repoId}|${dest}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          repoId: args.repoId,
          repoType: args.repoType ?? "model",
          revision: args.revision ?? "main",
          dest,
          pids: [],
          states: [],
          include: args.include,
          exclude: args.exclude,
          command: p.argv.join(" "),
        };
        groups.set(key, g);
      }
      g.pids.push(p.pid);
      g.states.push(p.state);
    }
    return [...groups.values()];
  }

  // ── progress ──

  private async describeGroup(g: Group): Promise<HfDownload> {
    const files = (await this.fetchTree(g.repoType, g.repoId, g.revision)) ?? [];
    const visible = files.filter((f) => this.matchesFilters(f.path, g.include, g.exclude));
    const classic = this.isClassicCacheLayout(g.dest);
    const filesTotal = visible.length;

    let filesDone = 0;
    let doneBytes = 0;
    for (const f of visible) {
      const finalPath = classic ? path.join(g.dest, "snapshots", g.revision, f.path) : path.join(g.dest, f.path);
      if (fs.existsSync(finalPath)) {
        filesDone++;
        doneBytes += f.size;
      }
    }
    doneBytes += this.sumIncompleteBytes(g.dest);
    const totalBytes = visible.reduce((sum, f) => sum + f.size, 0);

    const speedBps = this.updateSpeed(g.key, doneBytes);
    const etaSeconds =
      totalBytes > 0 && doneBytes < totalBytes && speedBps > 0 ? Math.round((totalBytes - doneBytes) / speedBps) : null;
    const status = g.states.length > 0 && g.states.every((s) => s === "T") ? "paused" : "downloading";

    return {
      repoId: g.repoId,
      dest: g.dest,
      pids: g.pids,
      filesDone,
      filesTotal,
      doneBytes,
      totalBytes,
      speedBps: Math.round(speedBps),
      etaSeconds,
      status,
      command: g.command,
    };
  }

  /** Instantaneous speed smoothed with an EMA over consecutive polls. */
  private updateSpeed(key: string, bytes: number): number {
    const now = Date.now();
    const prev = this.speedMap.get(key);
    let speed = 0;
    if (prev && now > prev.lastTs) {
      const dt = (now - prev.lastTs) / 1000;
      const inst = Math.max(0, (bytes - prev.lastBytes) / dt);
      speed = prev.speed === 0 ? inst : prev.speed * (1 - SPEED_EMA_ALPHA) + inst * SPEED_EMA_ALPHA;
    }
    this.speedMap.set(key, { lastBytes: bytes, lastTs: now, speed });
    return speed;
  }

  /** Classic cache layout: <dest>/snapshots/<rev>/<file> with symlinks into blobs/. */
  private isClassicCacheLayout(dest: string): boolean {
    try {
      return fs.statSync(path.join(dest, "snapshots")).isDirectory();
    } catch {
      return false;
    }
  }

  /** Sum sizes of all *.incomplete partial files under dest (recursively). */
  private sumIncompleteBytes(dest: string): number {
    let total = 0;
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith(".incomplete")) {
          try {
            total += fs.statSync(p).size;
          } catch {
            // partial vanished — ignore
          }
        }
      }
    };
    walk(dest);
    return total;
  }

  // ── Hugging Face API ──

  /** Repo file tree with sizes, or null when unavailable (offline / 404 / private). */
  async fetchTree(repoType: string, repoId: string, revision: string): Promise<TreeFile[] | null> {
    const candidates = [...new Set([repoType, "model", "dataset", "space"].filter((t): t is string => Boolean(REPO_TYPE_API[t])))];
    for (const type of candidates) {
      const url = `${HF_API_BASE}/${REPO_TYPE_API[type]}/${repoId}/tree/${encodeURIComponent(revision)}?recursive=true`;
      const files = await this.fetchTreeUrl(url);
      if (files) return files;
    }
    return null;
  }

  private async fetchTreeUrl(url: string): Promise<TreeFile[] | null> {
    try {
      const files: TreeFile[] = [];
      let next: string | undefined = url;
      for (let page = 0; next && page < 10; page++) {
        const res = await fetch(next, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) return null;
        const data = (await res.json()) as Array<{ type?: string; path?: string; size?: number }>;
        for (const e of data) {
          if (e.type === "file" && typeof e.path === "string") files.push({ path: e.path, size: e.size ?? 0 });
        }
        const link = res.headers.get("link") ?? "";
        const m = link.match(/<([^>]+)>;\s*rel="next"/);
        next = m ? m[1] : undefined;
      }
      return files;
    } catch {
      return null;
    }
  }

  // ── include/exclude (fnmatch-like, `*` matches `/`) ──

  private matchesFilters(filePath: string, include: string[], exclude: string[]): boolean {
    if (exclude.some((p) => HfDownloadsService.fnMatch(filePath, p))) return false;
    if (include.length === 0) return true;
    return include.some((p) => HfDownloadsService.fnMatch(filePath, p));
  }

  private static fnMatch(name: string, pattern: string): boolean {
    let re = "^";
    for (const c of pattern) {
      if (c === "*") re += ".*";
      else if (c === "?") re += ".";
      else re += c.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
    return new RegExp(re + "$").test(name);
  }
}
