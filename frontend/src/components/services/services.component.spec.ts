import { ComponentFixture, TestBed } from "@angular/core/testing";
import { HttpErrorResponse } from "@angular/common/http";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Observable, of, throwError } from "rxjs";
import { ServicesComponent, ServiceWithConfig } from "./services.component";
import { ServiceService } from "../../services/service.service";
import { ServiceListService } from "../../services/service-list.service";
import { SystemService } from "../../services/system.service";
import { AccountPasswordService } from "../../services/account-password.service";
import { ServerIdentityInfo } from "../../models/gpu";
import { LlamaServerDialogComponent } from "./llama-server-dialog/llama-server-dialog.component";
import { ServiceConfig, ServiceStatus } from "../../models/service";

const STATUSES: ServiceStatus[] = [
  { name: "llama-server", running: true, enabled: true, installed: true },
  { name: "nginx", running: true, enabled: true, installed: true },
];

const CONFIGS: ServiceConfig[] = [
  { name: "llama-server", type: "llama-server", command: "/bin/llama-server", flags: ["--model m.gguf"] },
];

const PRIVILEGED_SERVER: ServerIdentityInfo = {
  pid: 1234,
  platform: "linux",
  host: "127.0.0.1",
  port: 4243,
  startedAt: "2026-11-06T17:00:00.000Z",
  privileged: true,
};

describe("ServicesComponent", () => {
  let fixture: ComponentFixture<ServicesComponent>;
  let component: ServicesComponent;
  let serviceService: {
    fetchServices: jest.Mock;
    fetchConfigs: jest.Mock;
    control: jest.Mock;
    installService: jest.Mock;
    deleteConfig: jest.Mock;
    archiveService: jest.Mock;
    saveConfig: jest.Mock;
  };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };
  let systemService: { getSystemInfo: jest.Mock };
  let accountPassword: { askFor: jest.Mock };

  beforeEach(async () => {
    serviceService = {
      fetchServices: jest.fn().mockReturnValue(of(STATUSES)),
      fetchConfigs: jest.fn().mockReturnValue(of(CONFIGS)),
      control: jest.fn().mockReturnValue(of({ name: "llama-server", running: false, enabled: true, installed: true })),
      installService: jest.fn().mockReturnValue(of({ name: "llama-server", running: false, enabled: true, installed: true })),
      deleteConfig: jest.fn().mockReturnValue(of({ ok: true })),
      archiveService: jest.fn().mockReturnValue(of({ ok: true })),
      saveConfig: jest.fn().mockReturnValue(of({} as ServiceConfig)),
    };
    systemService = {
      getSystemInfo: jest.fn().mockResolvedValue({ server: PRIVILEGED_SERVER } as never),
    };
    dialog = { open: jest.fn().mockReturnValue({ afterClosed: () => of(undefined) }) };
    snackBar = { open: jest.fn() };
    accountPassword = { askFor: jest.fn().mockResolvedValue(undefined) };
    await TestBed.configureTestingModule({
      imports: [ServicesComponent],
      providers: [
        { provide: ServiceService, useValue: serviceService },
        { provide: SystemService, useValue: systemService },
        { provide: AccountPasswordService, useValue: accountPassword },
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

  it("deletes a custom service after confirmation", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.deleteService("llama-server");
    expect(serviceService.deleteConfig).toHaveBeenCalledWith("llama-server");
  });

  it("skips deletion when confirmation is declined", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    await component.deleteService("llama-server");
    expect(serviceService.deleteConfig).not.toHaveBeenCalled();
  });

  it("shows the backend error message (not [object Object]) on delete failure", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    serviceService.deleteConfig.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { error: "unit stop failed" } })),
    );
    await component.deleteService("llama-server");
    expect(snackBar.open).toHaveBeenCalledWith(
      'Delete "llama-server": unit stop failed',
      "Dismiss",
      expect.objectContaining({ duration: 8000 }),
    );
  });

  it("archives a custom service after confirmation", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.archiveService("llama-server");
    expect(serviceService.archiveService).toHaveBeenCalledWith("llama-server");
    expect(serviceService.fetchServices).toHaveBeenCalled();
  });

  it("skips archiving when confirmation is declined", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    await component.archiveService("llama-server");
    expect(serviceService.archiveService).not.toHaveBeenCalled();
  });

  it("shows the backend error message on archive failure", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    serviceService.archiveService.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { error: "unit stop failed" } })),
    );
    await component.archiveService("llama-server");
    expect(snackBar.open).toHaveBeenCalledWith(
      'Archive "llama-server": unit stop failed',
      "Dismiss",
      expect.objectContaining({ duration: 8000 }),
    );
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

  it("filters services by name (case-insensitive substring)", async () => {
    await fixture.whenStable();
    expect(component.filtered()).toHaveLength(2);

    component.filter.set("NGINX");
    expect(component.filtered().map((s) => s.name)).toEqual(["nginx"]);

    component.filter.set("llama");
    expect(component.filtered().map((s) => s.name)).toEqual(["llama-server"]);

    component.filter.set("no-such-service");
    expect(component.filtered()).toHaveLength(0);

    component.filter.set("   ");
    expect(component.filtered()).toHaveLength(2);
  });

  it("hasFlags reports whether a config has flags", () => {
    expect(component.hasFlags(CONFIGS[0])).toBe(true);
    expect(component.hasFlags({ name: "x", command: "/x", flags: [] })).toBe(false);
  });

  it("reads the answering backend identity once", async () => {
    await fixture.whenStable();
    expect(systemService.getSystemInfo).toHaveBeenCalledTimes(1);
    expect(component.serverIdentity()).toEqual(PRIVILEGED_SERVER);
    expect(component.backendUnprivileged()).toBe(false);
  });

  it("warns when the answering backend is not elevated", async () => {
    await fixture.whenStable();

    component.serverIdentity.set({ ...PRIVILEGED_SERVER, privileged: false });
    fixture.detectChanges();

    expect(component.backendUnprivileged()).toBe(true);
    const warning = (fixture.nativeElement as HTMLElement).querySelector(".privilege-warning");
    expect(warning?.textContent).toContain("not elevated");
    expect(warning?.textContent).toContain("pid 1234");
  });

  it("reinstalls a custom service after confirmation", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.reinstallService("llama-server");
    expect(serviceService.installService).toHaveBeenCalledWith("llama-server", undefined);
  });

  it("skips reinstall when confirmation is declined", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    await component.reinstallService("llama-server");
    expect(serviceService.installService).not.toHaveBeenCalled();
  });

  it("asks for the account password right before registering a service that runs as a user", async () => {
    await fixture.whenStable();
    component.configs.set([...CONFIGS, { name: "comfyui", command: "C:\\run.cmd", flags: [], user: "ynote2\\Yaroslav" }]);
    accountPassword.askFor.mockResolvedValue("s3cr3t");

    await component.installService("comfyui");

    expect(accountPassword.askFor).toHaveBeenCalledWith(expect.objectContaining({ name: "comfyui" }));
    expect(serviceService.installService).toHaveBeenCalledWith("comfyui", "s3cr3t");
  });

  it("does not register the service when the password prompt is cancelled", async () => {
    await fixture.whenStable();
    component.configs.set([...CONFIGS, { name: "comfyui", command: "C:\\run.cmd", flags: [], user: "ynote2\\Yaroslav" }]);
    accountPassword.askFor.mockResolvedValue(null);

    await component.installService("comfyui");

    expect(serviceService.installService).not.toHaveBeenCalled();
  });
});
