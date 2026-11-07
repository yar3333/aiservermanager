import { ComponentFixture, TestBed } from "@angular/core/testing";
import { HttpErrorResponse } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { of, throwError } from "rxjs";
import { ArchiveDialogComponent } from "./archive-dialog.component";
import { ServiceService } from "../../../services/service.service";
import { AccountPasswordService } from "../../../services/account-password.service";
import { ServiceConfig } from "../../../models/service";

const cfg = (name: string): ServiceConfig => ({ name, command: `/bin/${name}`, flags: [] });

describe("ArchiveDialogComponent", () => {
  let fixture: ComponentFixture<ArchiveDialogComponent>;
  let component: ArchiveDialogComponent;
  let serviceService: {
    fetchConfigs: jest.Mock;
    fetchArchivedConfigs: jest.Mock;
    archiveService: jest.Mock;
    restoreService: jest.Mock;
    deleteConfig: jest.Mock;
  };
  let dialogRef: { close: jest.Mock };
  let snackBar: { open: jest.Mock };
  let accountPassword: { askFor: jest.Mock };

  beforeEach(async () => {
    serviceService = {
      fetchConfigs: jest.fn().mockReturnValue(of([cfg("svc-a"), cfg("svc-b")])),
      fetchArchivedConfigs: jest.fn().mockReturnValue(of([cfg("archived-x")])),
      archiveService: jest.fn().mockReturnValue(of({ ok: true })),
      restoreService: jest.fn().mockReturnValue(of({ ok: true })),
      deleteConfig: jest.fn().mockReturnValue(of({ ok: true })),
    };
    dialogRef = { close: jest.fn() };
    snackBar = { open: jest.fn() };
    accountPassword = { askFor: jest.fn().mockResolvedValue(undefined) };

    await TestBed.configureTestingModule({
      imports: [ArchiveDialogComponent],
      providers: [
        { provide: ServiceService, useValue: serviceService },
        { provide: AccountPasswordService, useValue: accountPassword },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArchiveDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("loads active and archived services into one combined sorted list", async () => {
    await fixture.whenStable();
    expect(component.loading()).toBe(false);
    expect(component.entries()).toEqual([
      { name: "archived-x", archived: true },
      { name: "svc-a", archived: false },
      { name: "svc-b", archived: false },
    ]);
  });

  it("archiving a service flips its entry to archived", async () => {
    await fixture.whenStable();
    await component.archive("svc-a");
    expect(serviceService.archiveService).toHaveBeenCalledWith("svc-a");
    expect(component.active().map((c) => c.name)).toEqual(["svc-b"]);
    expect(component.entries().find((e) => e.name === "svc-a")?.archived).toBe(true);
  });

  it("restoring a service flips its entry back to active", async () => {
    await fixture.whenStable();
    await component.restore("archived-x");
    expect(serviceService.restoreService).toHaveBeenCalledWith("archived-x", undefined);
    expect(component.archived().map((c) => c.name)).toEqual([]);
    expect(component.entries().find((e) => e.name === "archived-x")?.archived).toBe(false);
  });

  it("asks for the account password before restoring a service that runs as a user", async () => {
    await fixture.whenStable();
    serviceService.fetchArchivedConfigs.mockReturnValueOnce(
      of([{ ...cfg("archived-x"), user: "ynote2\\Yaroslav" }]),
    );
    await component.ngOnInit();
    accountPassword.askFor.mockResolvedValue("s3cr3t");

    await component.restore("archived-x");

    expect(accountPassword.askFor).toHaveBeenCalledWith(
      expect.objectContaining({ name: "archived-x", user: "ynote2\\Yaroslav" }),
    );
    expect(serviceService.restoreService).toHaveBeenCalledWith("archived-x", "s3cr3t");
  });

  it("does not restore the service when the password prompt is cancelled", async () => {
    await fixture.whenStable();
    serviceService.fetchArchivedConfigs.mockReturnValueOnce(
      of([{ ...cfg("archived-x"), user: "ynote2\\Yaroslav" }]),
    );
    await component.ngOnInit();
    accountPassword.askFor.mockResolvedValue(null);

    await component.restore("archived-x");

    expect(serviceService.restoreService).not.toHaveBeenCalled();
    expect(component.entries().find((e) => e.name === "archived-x")?.archived).toBe(true);
  });

  it("removes a service from the list after confirmed deletion", async () => {
    await fixture.whenStable();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.remove("svc-a", false);
    expect(serviceService.deleteConfig).toHaveBeenCalledWith("svc-a");
    expect(component.entries().map((e) => e.name)).toEqual(["archived-x", "svc-b"]);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete service "svc-a"? Its systemd unit will be uninstalled and its config permanently removed.',
    );
  });

  it("can delete an archived service through the same endpoint", async () => {
    await fixture.whenStable();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    await component.remove("archived-x", true);
    expect(serviceService.deleteConfig).toHaveBeenCalledWith("archived-x");
    expect(component.entries().map((e) => e.name)).toEqual(["svc-a", "svc-b"]);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Delete archived service "archived-x"? Its config will be permanently removed.',
    );
  });

  it("skips deletion when confirmation is declined", async () => {
    await fixture.whenStable();
    jest.spyOn(window, "confirm").mockReturnValue(false);
    await component.remove("svc-a", false);
    expect(serviceService.deleteConfig).not.toHaveBeenCalled();
    expect(component.entries()).toHaveLength(3);
  });

  it("keeps the item in place and shows an error when the API fails", async () => {
    await fixture.whenStable();
    serviceService.archiveService.mockReturnValueOnce(throwError(() => new Error("boom")));
    await component.archive("svc-a");
    expect(component.entries().find((e) => e.name === "svc-a")?.archived).toBe(false);
    expect(snackBar.open).toHaveBeenCalled();
  });

  it("shows the backend error message (not [object Object]) on failure", async () => {
    await fixture.whenStable();
    serviceService.archiveService.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500, error: { error: "unit stop failed" } })),
    );
    await component.archive("svc-a");
    expect(snackBar.open).toHaveBeenCalledWith(
      'Archive "svc-a": unit stop failed',
      "Dismiss",
      expect.objectContaining({ duration: 6000 }),
    );
  });

  it("filters the combined list by name (case-insensitive substring)", async () => {
    await fixture.whenStable();
    expect(component.filtered()).toHaveLength(3);

    component.filter.set("ARCH");
    expect(component.filtered().map((e) => e.name)).toEqual(["archived-x"]);

    component.filter.set("svc");
    expect(component.filtered().map((e) => e.name)).toEqual(["svc-a", "svc-b"]);

    component.filter.set("no-such");
    expect(component.filtered()).toHaveLength(0);
  });

  it("closes with a truthy result only after a change was made", async () => {
    await fixture.whenStable();
    component.close();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
    await component.restore("archived-x");
    component.close();
    expect(dialogRef.close).toHaveBeenLastCalledWith(true);
  });
});
