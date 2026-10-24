import { ComponentFixture, TestBed } from "@angular/core/testing";
import { HttpErrorResponse } from "@angular/common/http";
import { MatDialogRef } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { of, throwError } from "rxjs";
import { ArchiveDialogComponent } from "./archive-dialog.component";
import { ServiceService } from "../../../services/service.service";
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
  };
  let dialogRef: { close: jest.Mock };
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    serviceService = {
      fetchConfigs: jest.fn().mockReturnValue(of([cfg("svc-a"), cfg("svc-b")])),
      fetchArchivedConfigs: jest.fn().mockReturnValue(of([cfg("archived-x")])),
      archiveService: jest.fn().mockReturnValue(of({ ok: true })),
      restoreService: jest.fn().mockReturnValue(of({ ok: true })),
    };
    dialogRef = { close: jest.fn() };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ArchiveDialogComponent],
      providers: [
        { provide: ServiceService, useValue: serviceService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArchiveDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("loads active and archived services", async () => {
    await fixture.whenStable();
    expect(component.active().map((c) => c.name)).toEqual(["svc-a", "svc-b"]);
    expect(component.archived().map((c) => c.name)).toEqual(["archived-x"]);
    expect(component.loading()).toBe(false);
  });

  it("archiving a service calls the API and moves it into the archive list", async () => {
    await fixture.whenStable();
    await component.archive("svc-a");
    expect(serviceService.archiveService).toHaveBeenCalledWith("svc-a");
    expect(component.active().map((c) => c.name)).toEqual(["svc-b"]);
    expect(component.archived().map((c) => c.name)).toEqual(["archived-x", "svc-a"]);
  });

  it("restoring a service calls the API and moves it back to the active list", async () => {
    await fixture.whenStable();
    await component.restore("archived-x");
    expect(serviceService.restoreService).toHaveBeenCalledWith("archived-x");
    expect(component.archived().map((c) => c.name)).toEqual([]);
    expect(component.active().map((c) => c.name)).toEqual(["archived-x", "svc-a", "svc-b"]);
  });

  it("keeps the item in place and shows an error when the API fails", async () => {
    await fixture.whenStable();
    serviceService.archiveService.mockReturnValueOnce(throwError(() => new Error("boom")));
    await component.archive("svc-a");
    expect(component.active().map((c) => c.name)).toEqual(["svc-a", "svc-b"]);
    expect(component.archived().map((c) => c.name)).toEqual(["archived-x"]);
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

  it("closes with a truthy result only after a change was made", async () => {
    await fixture.whenStable();
    component.close();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
    await component.restore("archived-x");
    component.close();
    expect(dialogRef.close).toHaveBeenLastCalledWith(true);
  });
});
