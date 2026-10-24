import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { injectable, unmanaged } from "inversify";
import { LmStudioModel } from "../models/LmStudio";

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
            return { name: `${pub}/${name}`, dir, size: await this.dirSize(dir) };
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

  /** Total size of all files under the model dir (recursively). */
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
        const p = path.join(d, e.name);
        try {
          if (e.isDirectory()) await walk(p);
          else if (e.isFile()) total += (await fs.promises.lstat(p)).size;
        } catch {
          // file vanished mid-walk — ignore
        }
      }
    };
    await walk(dir);
    return total;
  }
}
