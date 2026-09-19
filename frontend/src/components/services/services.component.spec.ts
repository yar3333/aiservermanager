import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Observable, of } from "rxjs";
import { ServicesComponent, ServiceWithConfig } from "./services.component";
import { ServiceService } from "../../services/service.service";
import { ServiceListService } from "../../services/service-list.service";
import { LlamaServerDialogComponent } from "./llama-server-dialog/llama-server-dialog.component";
import { ServiceConfig, ServiceStatus } from "../../models/service";

const STATUSES: ServiceStatus[] = [
  { name: "llama-server", running: true, enabled: true, installed: true },
  { name: "nginx", running: true, enabled: true, installed: true },
];

const CONFIGS: ServiceConfig[] = [
  { name: "llama-server", type: "llama-server", command: "/bin/llama-server", flags: ["--model m.gguf"] },
];

describe("ServicesComponent", () => {
  let fixture: ComponentFixture<ServicesComponent>;
  let component: ServicesComponent;
  let serviceService: {
    fetchServices: jest.Mock;
    fetchConfigs: jest.Mock;
    control: jest.Mock;
    deleteConfig: jest.Mock;
    saveConfig: jest.Mock;
  };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    serviceService = {
      fetchServices: jest.fn().mockReturnValue(of(STATUSES)),
      fetchConfigs: jest.fn().mockReturnValue(of(CONFIGS)),
      control: jest.fn().mockReturnValue(of({ name: "llama-server", running: false, enabled: true, installed: true })),
      deleteConfig: jest.fn().mockReturnValue(of({ ok: true })),
      saveConfig: jest.fn().mockReturnValue(of({} as ServiceConfig)),
    };
    dialog = { open: jest.fn().mockReturnValue({ afterClosed: () => of(undefined) }) };
    snackBar = { open: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ServicesComponent],
      providers: [
        { provide: ServiceService, useValue: serviceService },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ServicesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("loads services and configs", async () => {
    await fixture.whenStable();
    expect(component.services()).toEqual(STATUSES);
    expect(component.configs()).toEqual(CONFIGS);
    expect(component.loading()).toBe(false);
  });

  it("merges custom (with config) and managed services", async () => {
    await fixture.whenStable();
    const unified = component.unified();
    expect(unified).toHaveLength(2);

    const custom = unified.find((s) => s.name === "llama-server")!;
    expect(custom.hasConfig).toBe(true);
    expect(custom.config).toEqual(CONFIGS[0]);

    const managed = unified.find((s) => s.name === "nginx")!;
    expect(managed.hasConfig).toBe(false);
    expect(managed.config).toBeNull();
  });

  it("sends the control action and reloads", async () => {
    await fixture.whenStable();
    await component.control("llama-server", "stop");
    expect(serviceService.control).toHaveBeenCalledWith("llama-server", "stop");
    expect(serviceService.fetchServices).toHaveBeenCalled();
    expect(component.busy()).toBeNull();
  });

  it("skips an action that is already in flight for the same service", async () => {
    await fixture.whenStable();
    serviceService.control.mockReturnValue(new Observable(() => {}));
    const pending = component.control("llama-server", "stop");
    await component.control("llama-server", "stop");
    expect(serviceService.control).toHaveBeenCalledTimes(1);
    void pending;
  });

  it("shows a snackbar when the control result carries an error", async () => {
    await fixture.whenStable();
    serviceService.control.mockReturnValue(
      of({ name: "llama-server", running: false, enabled: true, installed: true, error: "unit failed" }),
    );
    await component.control("llama-server", "start");
    expect(snackBar.open).toHaveBeenCalledWith(
      "llama-server: unit failed",
      "Dismiss",
      expect.objectContaining({ duration: 8000 }),
    );
  });

  it("deletes a custom service", async () => {
    await fixture.whenStable();
    await component.deleteService("llama-server");
    expect(serviceService.deleteConfig).toHaveBeenCalledWith("llama-server");
  });

  it("cloneService opens the llama dialog with a unique clone name", async () => {
    await fixture.whenStable();
    const custom = component.unified().find((s) => s.name === "llama-server") as ServiceWithConfig;
    component.cloneService(custom);
    expect(dialog.open).toHaveBeenCalledWith(
      LlamaServerDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({
          clone: true,
          config: expect.objectContaining({ name: "llama-server-copy" }),
        }),
      }),
    );
  });

  it("hasFlags reports whether a config has flags", () => {
    expect(component.hasFlags(CONFIGS[0])).toBe(true);
    expect(component.hasFlags({ name: "x", command: "/x", flags: [] })).toBe(false);
  });
});
