/** A single weight file inside a model dir — one quantization (or a shard of one). */
export interface LmStudioModelFile {
  /** Path relative to the model dir, e.g. "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf". */
  name: string;
  /** File size in bytes. */
  size: number;
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
