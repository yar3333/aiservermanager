import { NvidiaSmiDetector } from "../nvidiaSmiDetector";
import * as execModule from "../../exec";

jest.mock("../../exec");
const mockSafeExec = execModule.safeExec as jest.MockedFunction<typeof execModule.safeExec>;

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
    it("parses a single GPU line", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GeForce RTX 3080, 10240, 4096, 50, 72, 1:00.0\n",
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
        vramUsed: 4,
        usage: 50,
        temperature: 72,
        pciBusId: "1:00.0",
      });
    });

    it("parses multiple GPU lines", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GeForce RTX 3080, 10240, 4096, 50, 72, 1:00.0\n1, GeForce RTX 3090, 24576, 8192, 80, 85, 2:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();

      expect(gpus).toHaveLength(2);
      expect(gpus[0].name).toBe("GeForce RTX 3080");
      expect(gpus[1].name).toBe("GeForce RTX 3090");
    });

    it("returns empty array on empty output", async () => {
      mockSafeExec.mockResolvedValue({ stdout: "", stderr: "" });

      const gpus = await detector.detect();
      expect(gpus).toEqual([]);
    });

    it("skips malformed lines with fewer than 7 columns", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, Bad Line\n1, Good GPU, 8192, 2048, 30, 60, 3:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();
      expect(gpus).toHaveLength(1);
      expect(gpus[0].name).toBe("Good GPU");
    });

    it("handles NaN values for usage and temperature", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, Some GPU, 8192, 2048, N/A, N/A, 4:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();
      expect(gpus[0].usage).toBe(0);
      expect(gpus[0].temperature).toBe(0);
    });

    it("converts VRAM from MiB to GB", async () => {
      mockSafeExec.mockResolvedValue({
        stdout: "0, GPU, 20480, 1024, 0, 0, 0:00.0\n",
        stderr: "",
      });

      const gpus = await detector.detect();
      expect(gpus[0].vramTotal).toBe(20);
      expect(gpus[0].vramUsed).toBe(1);
    });
  });
});
