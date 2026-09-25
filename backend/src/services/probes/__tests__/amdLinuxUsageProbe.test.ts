import "reflect-metadata";
import { AmdLinuxUsageProbe } from "../amdLinuxUsageProbe";
import { GpuInfo } from "../../../models/GpuInfo";
import * as execModule from "../../../helpers/ExecTools";

jest.mock("../../../helpers/ExecTools");

const mockSafeExec = execModule.ExecTools.safeExec as jest.MockedFunction<typeof execModule.ExecTools.safeExec>;

/** Real server layout: rocm-smi cards follow BDF order (83, 86, C3, C6). */
const busJson = JSON.stringify({
  card0: { "PCI Bus": "0000:83:00.0" },
  card1: { "PCI Bus": "0000:86:00.0" },
  card2: { "PCI Bus": "0000:C3:00.0" },
  card3: { "PCI Bus": "0000:C6:00.0" },
  card4: { "PCI Bus": "0000:01:00.0" }, // BMC iGPU, not in the detected list
});

const tempJson = JSON.stringify({
  card0: { "Temperature (Sensor edge) (C)": "41.0" },
  card1: { "Temperature (Sensor edge) (C)": "39.0" },
  card2: { "Temperature (Sensor edge) (C)": "44.0" },
  card3: { "Temperature (Sensor edge) (C)": "40.0" },
});

const usageJson = JSON.stringify({
  card0: { "GPU use (%)": "10" },
  card1: { "GPU use (%)": "0" },
  card2: { "GPU use (%)": "99" },
  card3: { "GPU use (%)": "50" },
});

const memJson = JSON.stringify({
  card0: { "VRAM Total Used Memory (B)": "23768989696" }, // ~22.14 GB
  card1: { "VRAM Total Used Memory (B)": "29442048" }, // ~0.03 GB
  card2: { "VRAM Total Used Memory (B)": "24883642368" }, // ~23.17 GB
  card3: { "VRAM Total Used Memory (B)": "23528808448" }, // ~21.91 GB
});

function makeGpu(pciBusId: string): GpuInfo {
  return { index: 0, vendor: "AMD", brand: "RADEON", name: "AMD Radeon RX 7900 XTX", gpuIndex: 0, vramTotal: 24, pciBusId };
}

/** Dispatch safeExec by command, like the real rocm-smi would. */
function mockRocmSmi(overrides: Partial<Record<string, string>> = {}): void {
  mockSafeExec.mockImplementation(async (command: string) => {
    const cmd = command.includes("--showbus")
      ? "--showbus"
      : command.includes("-t")
        ? "-t"
        : command.includes("-u")
          ? "-u"
          : command.includes("--showmeminfo")
            ? "--showmeminfo"
            : "other";
    const stdout = overrides[cmd];
    if (stdout !== undefined) return { stdout, stderr: "" };
    if (stdout === null) return { stdout: "", stderr: "error" };
    return { stdout: "", stderr: "" };
  });
}

function setCmd(data: Record<string, string>): Record<string, string> {
  return {
    "--showbus": busJson,
    "-t": tempJson,
    "-u": usageJson,
    "--showmeminfo": memJson,
    ...data,
  };
}

describe("AmdLinuxUsageProbe", () => {
  let probe: AmdLinuxUsageProbe;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform("linux");
    probe = new AmdLinuxUsageProbe();
  });

  afterEach(() => {
    setPlatform("linux");
  });

  describe("isAvailable", () => {
    it("returns true when rocm-smi responds", async () => {
      mockRocmSmi({ other: JSON.stringify({ card0: {} }) });
      expect(await probe.isAvailable()).toBe(true);
    });

    it("returns false when rocm-smi output is empty", async () => {
      mockRocmSmi({ other: "" });
      expect(await probe.isAvailable()).toBe(false);
    });

    it("returns false on non-linux without running the command", async () => {
      setPlatform("win32");
      const winProbe = new AmdLinuxUsageProbe(); // platform check happens in the constructor
      mockRocmSmi({ other: JSON.stringify({ card0: {} }) });
      expect(await winProbe.isAvailable()).toBe(false);
      expect(mockSafeExec).not.toHaveBeenCalled();
    });
  });

  describe("probe", () => {
    it("matches cards by PCI bus regardless of the static list order", async () => {
      // Static list in HIP (kernel probe) order — usage must still land on
      // the right bus: this is the regression for the mismatched VRAM bug
      const gpus = [makeGpu("C3:00.0"), makeGpu("C6:00.0"), makeGpu("83:00.0"), makeGpu("86:00.0")];

      mockRocmSmi(setCmd({}));
      const usages = await probe.probe(gpus);

      expect(usages).toHaveLength(4);
      const byBus = new Map(usages.map((u) => [u.key, u]));
      expect(byBus.get("83:00.0")?.vramUsed).toBeCloseTo(22.14, 1);
      expect(byBus.get("86:00.0")?.vramUsed).toBeCloseTo(0.03, 2);
      expect(byBus.get("C3:00.0")?.vramUsed).toBeCloseTo(23.17, 1);
      expect(byBus.get("C6:00.0")?.vramUsed).toBeCloseTo(21.91, 1);
      expect(byBus.get("C3:00.0")?.temperature).toBe(44);
      expect(byBus.get("C6:00.0")?.usage).toBe(50);
    });

    it("skips rocm-smi cards that are not in the static list", async () => {
      const gpus = [makeGpu("83:00.0"), makeGpu("C6:00.0")];

      mockRocmSmi(setCmd({}));
      const usages = await probe.probe(gpus);

      expect(usages.map((u) => u.key).sort()).toEqual(["83:00.0", "C6:00.0"]);
    });

    it("caches the card→bus mapping across polls", async () => {
      const gpus = [makeGpu("83:00.0")];

      mockRocmSmi(setCmd({}));
      await probe.probe(gpus);
      await probe.probe(gpus);

      const showbusCalls = mockSafeExec.mock.calls.filter(([cmd]) => cmd.includes("--showbus"));
      expect(showbusCalls).toHaveLength(1);
    });

    it("retries the bus lookup when --showbus fails on the first poll", async () => {
      const gpus = [makeGpu("83:00.0")];

      mockRocmSmi(setCmd({ "--showbus": "" }));
      const first = await probe.probe(gpus);
      expect(first).toEqual([]);

      mockRocmSmi(setCmd({}));
      const second = await probe.probe(gpus);
      expect(second.map((u) => u.key)).toEqual(["83:00.0"]);
    });

    it("returns zeroed metrics when metric commands fail", async () => {
      const gpus = [makeGpu("83:00.0")];

      mockRocmSmi(setCmd({ "-t": "", "-u": "", "--showmeminfo": "" }));
      const usages = await probe.probe(gpus);

      expect(usages).toEqual([{ key: "83:00.0", usage: 0, temperature: 0, vramUsed: 0 }]);
    });

    it("returns [] for an empty GPU list without running any command", async () => {
      expect(await probe.probe([])).toEqual([]);
      expect(mockSafeExec).not.toHaveBeenCalled();
    });
  });
});
