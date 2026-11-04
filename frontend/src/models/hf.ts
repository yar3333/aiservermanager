export type HfDownloadStatus = "downloading" | "paused";

/** One active Hugging Face download (process group for a single repo). */
export interface HfDownload {
  repoId: string;
  dest: string;
  pids: number[];
  filesDone: number;
  filesTotal: number;
  doneBytes: number;
  /** 0 = total unknown (repo tree could not be fetched). */
  totalBytes: number;
  speedBps: number;
  /** null when unknown. */
  etaSeconds: number | null;
  status: HfDownloadStatus;
  command: string;
}

export interface HfStatus {
  installed: boolean;
  version?: string;
}

/** A single weight file inside a cached model — one quantization (or a sharded one). */
export interface HfLocalModelFile {
  /** Path relative to a snapshot revision dir; for a sharded group — the base name without
   *  the "-NNNNN-of-NNNNN" suffix, e.g. "UD-Q4_K_XL/model-UD-Q4_K_XL.gguf". */
  name: string;
  /** Total size in bytes (sum of all shards for a group). */
  size: number;
  /** Shard paths relative to the snapshot dir — present only when shards are grouped. */
  shards?: string[];
}

/** A model already present in the local Hugging Face cache. */
export interface HfLocalModel {
  /** Repo id, e.g. "org/model". */
  name: string;
  /** Full path of the cache directory. */
  dir: string;
  /** Total size on disk in bytes. */
  size: number;
  /** Weight files in the model snapshots (each = a quantization or a shard group). */
  files: HfLocalModelFile[];
}

/** A blob file in the shared hub/blobs referenced by no model. */
export interface HfOrphanBlob {
  /** Full path of the blob file. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** Last modification time (epoch ms). */
  modifiedMs: number;
}
