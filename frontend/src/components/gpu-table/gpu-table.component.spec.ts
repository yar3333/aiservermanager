import { ComponentFixture, TestBed } from "@angular/core/testing";
import { GpuTableComponent } from "./gpu-table.component";
import { GpuWithUsage } from "../../models/gpu";

function makeGpu(overrides: Partial<GpuWithUsage> = {}): GpuWithUsage {
  return {
    index: 0,
    vendor: "NVIDIA",
    brand: "MSI",
    name: "RTX 4090",
    gpuIndex: 0,
    vramTotal: 24,
    pciBusId: "01:00.0",
    key: "01:00.0",
    usage: 50,
    temperature: 60,
    vramUsed: 12,
    ...overrides,
  };
}

describe("GpuTableComponent", () => {
  let fixture: ComponentFixture<GpuTableComponent>;
  let component: GpuTableComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GpuTableComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(GpuTableComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput("gpus", [makeGpu()]);
    fixture.detectChanges();
  });

  it("computes the vram usage percent", () => {
    expect(component.vramPercent(makeGpu({ vramTotal: 24, vramUsed: 6 }))).toBe(25);
    expect(component.vramPercent(makeGpu({ vramTotal: 0, vramUsed: 4 }))).toBe(0);
  });

  it("maps usage values to colors by threshold", () => {
    expect(component.colorForUsage(10)).toBe("#4caf50");
    expect(component.colorForUsage(40)).toBe("#ff9800");
    expect(component.colorForUsage(75)).toBe("#f44336");
  });

  it("maps temperatures to colors by threshold", () => {
    expect(component.colorForTemp(59)).toBe("#4caf50");
    expect(component.colorForTemp(60)).toBe("#ff9800");
    expect(component.colorForTemp(80)).toBe("#f44336");
  });

  it("shortens AMD Radeon RX names", () => {
    expect(component.makeGpuNameShort("AMD Radeon RX 7900 XTX")).toBe("RX 7900 XTX");
    expect(component.makeGpuNameShort("RTX 4090")).toBe("RTX 4090");
  });

  it("marks vendor css classes", () => {
    expect(component.getVendorCssClass(makeGpu({ vendor: "NVIDIA" }))["gpu-vendor-nvidia"]).toBe(true);
    expect(component.getVendorCssClass(makeGpu({ vendor: "AMD" }))["gpu-vendor-amd"]).toBe(true);
    const other = component.getVendorCssClass(makeGpu({ vendor: "Intel" }));
    expect(other["gpu-vendor-other"]).toBe(true);
    expect(other["gpu-vendor-nvidia"]).toBe(false);
  });

  it("does not display a gpuLabel column", () => {
    expect(component.displayedColumns).not.toContain("gpuLabel");
  });
});
