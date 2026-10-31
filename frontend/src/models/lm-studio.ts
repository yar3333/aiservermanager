/** A single weight file inside a model dir — one quantization (or a sharded one). */
export interface LmStudioModelFile {
  /** Path relative to the model dir; for a sharded group — the base name without
   *  the "-NNNNN-of-NNNNN" suffix, e.g. "Qwen3.8-27B-BF16.gguf". */
  name: string;
  /** Total size in bytes (sum of all shards for a group). */
  size: number;
  /** Shard paths relative to the model dir — present only when shards are grouped. */
  shards?: string[];
}

/** A model downloaded via LM Studio (from ~/.lmstudio/models/<publisher>/<name>). */
export interface LmStudioModel {
  /** Model id, e.g. "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF". */
  name: string;
  /** Full path of the model directory. */
  dir: string;
  /** Total size on disk in bytes. */
  size: number;
  /** GGUF files in the model dir (each = a quantization or a shard), sorted by name. */
  files: LmStudioModelFile[];
}
