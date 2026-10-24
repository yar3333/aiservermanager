/** Status of an active `hf download` process group. */
export type HfDownloadStatus = "downloading" | "paused";

/**
 * One active Hugging Face download (a group of `hf download` processes
 * targeting the same repository).
 */
export interface HfDownload {
  repoId: string;
  /** Destination directory (from --local-dir or the HF cache layout). */
  dest: string;
  /** PIDs of all processes in the group (worker + shell wrappers). */
  pids: number[];
  filesDone: number;
  filesTotal: number;
  doneBytes: number;
  /** 0 = total unknown (repo tree could not be fetched). */
  totalBytes: number;
  /** Bytes per second (EMA of recent polls), 0 on the first poll. */
  speedBps: number;
  /** Estimated seconds until completion, null when unknown. */
  etaSeconds: number | null;
  status: HfDownloadStatus;
  command: string;
}

/** Availability of the `hf` CLI on this machine. */
export interface HfStatus {
  installed: boolean;
  version?: string;
}

/** A model already present in the local Hugging Face cache (<HF_HOME>/hub/models--org--name). */
export interface HfLocalModel {
  /** Repo id, e.g. "org/model". */
  name: string;
  /** Full path of the cache directory. */
  dir: string;
  /** Total size on disk in bytes. */
  size: number;
}
