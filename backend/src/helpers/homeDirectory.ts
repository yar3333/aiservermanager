import * as os from "os";

/**
 * Home directory of the process.
 *
 * Windows sets `USERPROFILE`, not `HOME` — an elevated PowerShell starts node
 * with no HOME at all, and `path.join(process.env.HOME ?? "", ".config", …)`
 * then silently produces a *relative* path resolved against the working
 * directory. The manager would read and write its configs in the wrong place,
 * so every home-based path goes through this helper.
 */
export function homeDirectory(): string {
  return process.env.HOME?.trim() || os.homedir();
}
