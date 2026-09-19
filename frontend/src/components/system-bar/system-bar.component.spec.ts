import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { SystemBarComponent } from "./system-bar.component";
import { SystemService } from "../../services/system.service";
import { SystemInfo } from "../../models/gpu";

const SYSTEM_INFO: SystemInfo = {
  cpuUsage: 42.3,
  memoryTotal: 34359738368,
  memoryUsed: 10737418240,
  memoryPercent: 31,
};

describe("SystemBarComponent", () => {
  let fixture: ComponentFixture<SystemBarComponent>;
  let component: SystemBarComponent;
  let dialog: { open: jest.Mock };
  let systemService: { reboot: jest.Mock; shutdown: jest.Mock };

  beforeEach(async () => {
    dialog = { open: jest.fn() };
    systemService = {
      reboot: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [SystemBarComponent],
      providers: [{ provide: SystemService, useValue: systemService }],
    })
      .overrideProvider(MatDialog, { useValue: dialog })
      .compileComponents();
    fixture = TestBed.createComponent(SystemBarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput("systemInfo", SYSTEM_INFO);
    fixture.detectChanges();
  });

  it("opens the system info dialog", () => {
    component.openSystemInfo();
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it("formats bytes as whole GB", () => {
    expect(component.formatBytes(0)).toBe("0 GB");
    expect(component.formatBytes(34359738368)).toBe("32 GB");
    expect(component.formatBytes(1)).toBe("1 GB");
  });

  it("ceils the cpu usage", () => {
    expect(component.ceilCpu(42.3)).toBe(43);
    expect(component.ceilCpu(0.1)).toBe(1);
  });

  it("maps usage values to colors by threshold", () => {
    expect(component.colorForUsage(20)).toBe("#4caf50");
    expect(component.colorForUsage(50)).toBe("#ff9800");
    expect(component.colorForUsage(90)).toBe("#f44336");
  });

  it("reboots only after confirmation", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.reboot();
    expect(systemService.reboot).toHaveBeenCalledTimes(1);
  });

  it("skips reboot when confirmation is declined", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(false);
    await component.reboot();
    expect(systemService.reboot).not.toHaveBeenCalled();
  });

  it("shuts down only after confirmation", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.shutdown();
    expect(systemService.shutdown).toHaveBeenCalledTimes(1);
  });
});
