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

/** A model already present in the local Hugging Face cache. */
export interface HfLocalModel {
  /** Repo id, e.g. "org/model". */
  name: string;
  /** Full path of the cache directory. */
  dir: string;
  /** Total size on disk in bytes. */
  size: number;
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
