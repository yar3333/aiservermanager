import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HfDownloadsService } from "../hfDownloadsService";
import { ExecTools } from "../../helpers/ExecTools";

function makeProc(root: string, pid: number, cmdline: string, state = "S", hfHome?: string): void {
  const dir = path.join(root, String(pid));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "cmdline"), cmdline.split(" ").join("\0") + "\0");
  fs.writeFileSync(path.join(dir, "stat"), `${pid} (test) ${state} 1 0 0 0 -1 4194560`);
  fs.writeFileSync(path.join(dir, "environ"), hfHome ? `HF_HOME=${hfHome}\0PATH=/usr/bin\0` : "PATH=/usr/bin\0");
}

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    json: async () => data,
    headers: { get: () => null },
  } as unknown as Response;
}

describe("HfDownloadsService", () => {
  let tmp: string;
  let procRoot: string;
  let dest: string;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hfds-test-"));
    procRoot = path.join(tmp, "proc");
    dest = path.join(tmp, "dest");
    fs.mkdirSync(procRoot, { recursive: true });
    mockFetch = jest.fn();
    jest.spyOn(global, "fetch").mockImplementation(mockFetch as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("isHfDownloadCmd", () => {
    it("matches python worker with full CLI path", () => {
      expect(HfDownloadsService.isHfDownloadCmd("/home/u/.venv/bin/python /home/u/.local/bin/hf download org/model")).toBe(true);
    });

    it("matches huggingface-cli", () => {
      expect(HfDownloadsService.isHfDownloadCmd("python /usr/local/bin/huggingface-cli download org/model")).toBe(true);
    });

    it("matches bash -c wrapper", () => {
      const cmd = "bash -c cd /home/u && export HF_HOME=/x && hf download org/model --local-dir /x > /tmp/log 2>&1";
      expect(HfDownloadsService.isHfDownloadCmd(cmd)).toBe(true);
    });

    it("ignores other hf subcommands", () => {
      expect(HfDownloadsService.isHfDownloadCmd("hf whoami")).toBe(false);
      expect(HfDownloadsService.isHfDownloadCmd("hf auth login")).toBe(false);
    });

    it("ignores lookalike tokens", () => {
      expect(HfDownloadsService.isHfDownloadCmd("vim hf-download-notes.txt")).toBe(false);
      expect(HfDownloadsService.isHfDownloadCmd("ls /opt/hf/download")).toBe(false);
    });
  });

  describe("listDownloads", () => {
    const tree = [
      { type: "file", path: "a.bin", size: 1000 },
      { type: "file", path: "b.bin", size: 2000 },
      { type: "dir", path: "subdir" },
    ];

    function setupFlatDest(): void {
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(path.join(dest, "a.bin"), "x".repeat(1000));
      const cacheDir = path.join(dest, ".cache", "huggingface", "download");
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, "abc.etag.incomplete"), "x".repeat(500));
    }

    it("reports flat layout progress: complete files + partials", async () => {
      makeProc(procRoot, 1111, `/opt/venv/bin/python /opt/bin/hf download org/model --local-dir ${dest}`);
      setupFlatDest();
      mockFetch.mockResolvedValue(jsonResponse(tree));

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.repoId).toBe("org/model");
      expect(d.dest).toBe(dest);
      expect(d.pids).toEqual([1111]);
      expect(d.filesTotal).toBe(2);
      expect(d.filesDone).toBe(1);
      expect(d.totalBytes).toBe(3000);
      expect(d.doneBytes).toBe(1500);
      expect(d.status).toBe("downloading");
      expect(d.speedBps).toBe(0);
      expect(d.etaSeconds).toBeNull();
    });

    it("groups worker and bash wrapper into one entry", async () => {
      makeProc(procRoot, 1111, `/opt/venv/bin/python /opt/bin/hf download org/model --local-dir ${dest}`);
      makeProc(
        procRoot,
        2222,
        `bash -c cd /home/u && hf download org/model --local-dir ${dest} > /tmp/log 2>&1`,
      );
      setupFlatDest();
      mockFetch.mockResolvedValue(jsonResponse(tree));

      const svc = new HfDownloadsService(procRoot);
      const list = await svc.listDownloads();

      expect(list).toHaveLength(1);
      expect(list[0].pids.sort()).toEqual([1111, 2222]);
    });

    it("computes speed and eta on the second poll", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      setupFlatDest();
      mockFetch.mockResolvedValue(jsonResponse(tree));

      let now = 1_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => now);
      const svc = new HfDownloadsService(procRoot);

      await svc.listDownloads();
      now += 2000;
      const partial = path.join(dest, ".cache", "huggingface", "download", "abc.etag.incomplete");
      fs.writeFileSync(partial, "x".repeat(1500));

      const [d] = await svc.listDownloads();

      expect(d.doneBytes).toBe(2500);
      expect(d.speedBps).toBe(500); // 1000 bytes / 2 s
      expect(d.etaSeconds).toBe(1); // 500 bytes left / 500 B/s
    });

    it("marks group paused when all processes are stopped (state T)", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`, "T");
      setupFlatDest();
      mockFetch.mockResolvedValue(jsonResponse(tree));

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.status).toBe("paused");
    });

    it("applies --include / --exclude filters (fnmatch, * matches /)", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest} --include *.safetensors`);
      fs.mkdirSync(dest, { recursive: true });
      mockFetch.mockResolvedValue(
        jsonResponse([
          { type: "file", path: "model.safetensors", size: 700 },
          { type: "file", path: "sub/model-2.safetensors", size: 300 },
          { type: "file", path: "config.json", size: 10 },
        ]),
      );

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.filesTotal).toBe(2);
      expect(d.totalBytes).toBe(1000);
    });

    it("resolves dest from HF_HOME when --local-dir is absent", async () => {
      const home = path.join(tmp, "hfhome");
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model`, "S", home);
      mockFetch.mockResolvedValue(jsonResponse([]));

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.dest).toBe(path.join(home, "hub", "models--org--model"));
    });

    it("returns totalBytes=0 when the repo tree is unavailable", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      fs.mkdirSync(dest, { recursive: true });
      mockFetch.mockResolvedValue(jsonResponse([], false));

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.totalBytes).toBe(0);
      expect(d.filesTotal).toBe(0);
      expect(d.etaSeconds).toBeNull();
    });

    it("falls back to other repo types when the primary 404s", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest} --repo-type dataset`);
      fs.mkdirSync(dest, { recursive: true });
      mockFetch
        .mockResolvedValueOnce(jsonResponse([], false)) // datasets → 404
        .mockResolvedValueOnce(jsonResponse([{ type: "file", path: "d.csv", size: 42 }])); // model → ok

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.totalBytes).toBe(42);
    });

    it("supports classic cache layout (snapshots/<rev>/<file>)", async () => {
      const home = path.join(tmp, "hfhome");
      const classic = path.join(home, "hub", "models--org--model");
      fs.mkdirSync(path.join(classic, "snapshots", "main"), { recursive: true });
      fs.writeFileSync(path.join(classic, "snapshots", "main", "a.bin"), "x".repeat(1000));
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model`, "S", home);
      mockFetch.mockResolvedValue(jsonResponse(tree));

      const svc = new HfDownloadsService(procRoot);
      const [d] = await svc.listDownloads();

      expect(d.dest).toBe(classic);
      expect(d.filesDone).toBe(1);
    });

    it("returns [] when there are no hf processes", async () => {
      const svc = new HfDownloadsService(procRoot);
      expect(await svc.listDownloads()).toEqual([]);
    });

    it("rescans once after a transient empty /proc scan", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      fs.mkdirSync(dest, { recursive: true });
      mockFetch.mockResolvedValue(jsonResponse(tree));

      const svc = new HfDownloadsService(procRoot);
      expect(await svc.listDownloads()).toHaveLength(1); // populates speedMap

      const realScan = (svc as any).scanProcesses.bind(svc);
      let emptyReturned = false;
      (svc as any).scanProcesses = function () {
        if (!emptyReturned) {
          emptyReturned = true;
          return [];
        }
        return realScan();
      };

      expect(await svc.listDownloads()).toHaveLength(1); // retry finds the process
    });
  });

  describe("sendAction", () => {
    beforeEach(() => {
      fs.mkdirSync(dest, { recursive: true });
      mockFetch.mockResolvedValue(jsonResponse([]));
    });

    it("sends SIGSTOP to all group pids on pause", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      makeProc(procRoot, 2222, `bash -c hf download org/model --local-dir ${dest}`);
      const kill = jest.spyOn(process, "kill").mockReturnValue(true);

      const svc = new HfDownloadsService(procRoot);
      await svc.sendAction("pause", "org/model", dest);

      expect(kill).toHaveBeenCalledTimes(2);
      expect(kill).toHaveBeenCalledWith(1111, "SIGSTOP");
      expect(kill).toHaveBeenCalledWith(2222, "SIGSTOP");
    });

    it("sends SIGCONT on resume", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      const kill = jest.spyOn(process, "kill").mockReturnValue(true);

      const svc = new HfDownloadsService(procRoot);
      await svc.sendAction("resume", "org/model", dest);

      expect(kill).toHaveBeenCalledWith(1111, "SIGCONT");
    });

    it("sends SIGTERM on cancel", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      const kill = jest.spyOn(process, "kill").mockReturnValue(true);

      const svc = new HfDownloadsService(procRoot);
      await svc.sendAction("cancel", "org/model", dest);

      expect(kill).toHaveBeenCalledWith(1111, "SIGTERM");
    });

    it("throws when no matching download", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      const kill = jest.spyOn(process, "kill").mockReturnValue(true);

      const svc = new HfDownloadsService(procRoot);
      await expect(svc.sendAction("pause", "other/repo", dest)).rejects.toThrow("No active download");
      expect(kill).not.toHaveBeenCalled();
    });

    it("throws when all pids are already gone", async () => {
      makeProc(procRoot, 1111, `/opt/bin/hf download org/model --local-dir ${dest}`);
      jest.spyOn(process, "kill").mockImplementation(() => {
        const err = new Error("kill failed") as NodeJS.ErrnoException;
        err.code = "ESRCH";
        throw err;
      });

      const svc = new HfDownloadsService(procRoot);
      await expect(svc.sendAction("pause", "org/model", dest)).rejects.toThrow("No active download");
    });
  });

  describe("isInstalled", () => {
    it("returns installed with version when hf is on PATH", async () => {
      const safeExec = jest.spyOn(ExecTools, "safeExec");
      safeExec
        .mockResolvedValueOnce({ stdout: "/usr/local/bin/hf\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "1.15.0\n", stderr: "" });

      const svc = new HfDownloadsService(procRoot);
      await expect(svc.isInstalled()).resolves.toEqual({ installed: true, version: "1.15.0" });
    });

    it("returns installed=false when hf is missing", async () => {
      jest.spyOn(ExecTools, "safeExec").mockResolvedValue({ stdout: "", stderr: "" });

      const svc = new HfDownloadsService(procRoot);
      await expect(svc.isInstalled()).resolves.toEqual({ installed: false });
    });
  });
});
