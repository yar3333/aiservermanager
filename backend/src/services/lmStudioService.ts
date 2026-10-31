import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { injectable, unmanaged } from "inversify";
import { LmStudioModel, LmStudioModelFile } from "../models/LmStudio";

/** Lists models downloaded via LM Studio from ~/.lmstudio/models/<publisher>/<name>. */
@injectable()
export class LmStudioService {
  /** Override of the LM Studio models root; resolved from HOME when absent. */
  private readonly modelsRootOverride?: string;

  constructor(@unmanaged() modelsRootOverride?: string) {
    this.modelsRootOverride = modelsRootOverride;
  }

  /** LM Studio's default download directory. */
  private modelsRoot(): string {
    return this.modelsRootOverride || path.join(os.homedir(), ".lmstudio", "models");
  }

  /** List models present in the LM Studio folder with their size on disk. */
  async listModels(): Promise<LmStudioModel[]> {
    const root = this.modelsRoot();
    const publishers = await this.listDirs(root);
    const groups = await Promise.all(
      publishers.map(async (pub) => {
        const names = await this.listDirs(path.join(root, pub));
        return Promise.all(
          names.map(async (name): Promise<LmStudioModel> => {
            const dir = path.join(root, pub, name);
            const files = await this.listGgufFiles(dir);
            const size = files.reduce((sum, f) => sum + f.size, 0);
            return { name: `${pub}/${name}`, dir, size, files };
          }),
        );
      }),
    );
    return groups.flat().sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Delete a model directory (name = "publisher/model"), then remove the
   *  publisher dir when it becomes empty. */
  async deleteModel(name: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
      throw new Error(`Invalid model name: ${name}`);
    }
    const root = this.modelsRoot();
    const dir = path.join(root, ...name.split("/"));
    let real: string;
    try {
      real = await fs.promises.realpath(dir);
    } catch {
      throw new Error(`Model not found: ${name}`);
    }
    const rootReal = await fs.promises.realpath(root).catch(() => null);
    if (rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error("Invalid model path");
    }
    await fs.promises.rm(real, { recursive: true });
    if (rootReal) await this.removeEmptyParents(real, rootReal);
  }

  /** Delete a single GGUF file (fileName = path relative to the model dir),
   *  then remove now-empty parent dirs of the file. */
  async deleteModelFile(name: string, fileName: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
      throw new Error(`Invalid model name: ${name}`);
    }
    if (!fileName || fileName.split(/[\\/]/).some((p) => p === "..")) {
      throw new Error("Invalid file path");
    }
    const root = this.modelsRoot();
    const dir = path.join(root, ...name.split("/"));
    const file = path.join(dir, fileName);
    let real: string;
    try {
      real = await fs.promises.realpath(file);
    } catch {
      throw new Error(`File not found: ${name}/${fileName}`);
    }
    const rootReal = await fs.promises.realpath(root).catch(() => null);
    if (rootReal && !real.startsWith(rootReal + path.sep)) {
      throw new Error("Invalid file path");
    }
    await fs.promises.rm(real);
    if (rootReal) await this.removeEmptyParents(real, rootReal);
    // Prune the model dir and publisher dir when everything is gone.
    await this.removeEmptyParents(file, rootReal ?? root);
  }

  /** Remove now-empty parent dirs of a deleted model, up to (not including) stopAt. */
  private async removeEmptyParents(file: string, stopAt: string): Promise<void> {
    let dir = path.dirname(file);
    while (dir.startsWith(stopAt + path.sep) && dir !== stopAt) {
      try {
        await fs.promises.rmdir(dir);
      } catch {
        return; // not empty (or gone) — done
      }
      dir = path.dirname(dir);
    }
  }

  /** Names of subdirectories, or [] when the dir is unreadable (missing / no permission). */
  private async listDirs(dir: string): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  /** Regex for shard suffixes: "-00001-of-00003" before ".gguf". */
  private static readonly SHARD_RE = /^(.*?)-(\d{5})-of-(\d{5})\.gguf$/i;

  /** GGUF files under the model dir (recursively), sorted by relative path.
   *  Sharded weights ("-NNNNN-of-NNNNN" suffixes) are grouped into one entry
   *  with summed size and the shard paths in `shards`. */
  private async listGgufFiles(dir: string): Promise<LmStudioModelFile[]> {
    const files: LmStudioModelFile[] = [];
    const walk = async (d: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        try {
          if (e.isDirectory()) await walk(p);
          else if (e.isFile() && e.name.toLowerCase().endsWith(".gguf")) {
            files.push({ name: path.relative(dir, p), size: (await fs.promises.lstat(p)).size });
          }
        } catch {
          // file vanished mid-walk — ignore
        }
      }
    };
    await walk(dir);
    files.sort((a, b) => a.name.localeCompare(b.name));
    return this.groupShards(files);
  }

  /** Merge "-NNNNN-of-NNNNN" shards into a single entry per base name. */
  private groupShards(files: LmStudioModelFile[]): LmStudioModelFile[] {
    const result: LmStudioModelFile[] = [];
    let i = 0;
    while (i < files.length) {
      const m = LmStudioService.SHARD_RE.exec(files[i].name);
      if (!m) {
        result.push(files[i]);
        i++;
        continue;
      }
      const base = `${m[1]}.gguf`;
      const shards: string[] = [];
      let size = 0;
      while (i < files.length) {
        const mm = LmStudioService.SHARD_RE.exec(files[i].name);
        if (!mm || `${mm[1]}.gguf` !== base) break;
        shards.push(files[i].name);
        size += files[i].size;
        i++;
      }
      result.push({ name: base, size, shards });
    }
    return result;
  }
}
