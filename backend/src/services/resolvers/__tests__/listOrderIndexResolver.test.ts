import "reflect-metadata";
import { ListOrderIndexResolver } from "../listOrderIndexResolver";
import { GpuInfo } from "../../../models/GpuInfo";

function makeGpu(pciBusId: string): GpuInfo {
  return { index: 0, vendor: "NVIDIA", brand: "NVIDIA", name: "GPU", gpuIndex: 0, vramTotal: 24, pciBusId };
}

describe("ListOrderIndexResolver", () => {
  const resolver = new ListOrderIndexResolver();

  it("is always available", async () => {
    expect(await resolver.isAvailable()).toBe(true);
  });

  it("assigns sequential indices in list order and returns the count", async () => {
    const gpus = [makeGpu("1:00.0"), makeGpu("2:00.0"), makeGpu("3:00.0")];

    const assigned = await resolver.resolve(gpus);

    expect(assigned).toBe(3);
    expect(gpus.map((g) => g.gpuIndex)).toEqual([0, 1, 2]);
  });

  it("returns 0 for an empty list", async () => {
    expect(await resolver.resolve([])).toBe(0);
  });
});
