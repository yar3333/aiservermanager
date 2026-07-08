import { NvidiaSmiDetector } from "../nvidiaSmiDetector";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("../../../helpers/ExecTools");
const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

describe("NvidiaSmiDetector", () => {
  let detector: NvidiaSmiDetector;

  beforeEach(() => {
    jest.clearAllMocks();
    detector = new NvidiaSmiDetector();
  });

  describe("isAvailable", () => {
    it("returns true when nvidia-smi returns output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "0\n1\n", stderr: "" });

      const result = await detector.isAvailable();
      expect(result).toBe(true);
    });

    it("returns false when nvidia-smi returns empty output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "not found" });

      const result = await detector.isAvailable();
      expect(result).toBe(false);
    });

    it("caches the result after first call", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "0\n", stderr: "" });

      await detector.isAvailable();
      await detector.isAvailable();

      expect(mockSafeExec).toHaveBeenCalledTimes(1);
    });
  });

  describe("detect", () => {
    it("parses a single GPU line (static info only)", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GeForce RTX 3080, 10240, 1:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();

      expect(gpus).toHaveLength(1);
      expect(gpus[0]).toMatchObject({
        index: 0,
        vendor: "NVIDIA",
        brand: "NVIDIA",
        name: "GeForce RTX 3080",
        vramTotal: 10,
        pciBusId: "1:00.0",
      });
    });

    it("parses multiple GPU lines", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GeForce RTX 3080, 10240, 1:00.0\n1, GeForce RTX 3090, 24576, 2:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();

      expect(gpus).toHaveLength(2);
      expect(gpus[0].name).toBe("GeForce RTX 3080");
      expect(gpus[1].name).toBe("GeForce RTX 3090");
    });

    it("strips 0000: domain prefix from pci.bus_id", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GeForce RTX 3080, 10240, 0000:01:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();
      expect(gpus[0].pciBusId).toBe("01:00.0");
    });

    it("returns empty array on empty output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });

      const gpus = await detector.detect();
      expect(gpus).toEqual([]);
    });

    it("skips malformed lines with fewer than 4 columns", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, Bad Line\n1, Good GPU, 8192, 3:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();
      expect(gpus).toHaveLength(1);
      expect(gpus[0].name).toBe("Good GPU");
    });

    it("converts VRAM from MiB to GB", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GPU, 20480, 0:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();
      expect(gpus[0].vramTotal).toBe(20);
    });
  });
});
