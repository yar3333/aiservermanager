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
