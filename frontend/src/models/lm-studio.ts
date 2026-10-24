/** A model downloaded via LM Studio (from ~/.lmstudio/models/<publisher>/<name>). */
export interface LmStudioModel {
  /** Model id, e.g. "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF". */
  name: string;
  /** Full path of the model directory. */
  dir: string;
  /** Total size on disk in bytes. */
  size: number;
}
