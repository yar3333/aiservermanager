import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { of } from "rxjs";
import { ManagedServicesDialogComponent } from "./managed-services-dialog.component";
import { ServiceService } from "../../../services/service.service";

describe("ManagedServicesDialogComponent", () => {
  let fixture: ComponentFixture<ManagedServicesDialogComponent>;
  let component: ManagedServicesDialogComponent;
  let serviceService: {
    listAvailableServices: jest.Mock;
    listManagedServices: jest.Mock;
    addManagedService: jest.Mock;
    removeManagedService: jest.Mock;
  };
  let dialogRef: { close: jest.Mock };

  beforeEach(async () => {
    serviceService = {
      listAvailableServices: jest.fn().mockReturnValue(of(["nginx", "postgresql"])),
      listManagedServices: jest.fn().mockReturnValue(of(["postgresql", "ghost-svc"])),
      addManagedService: jest.fn().mockReturnValue(of({ ok: true })),
      removeManagedService: jest.fn().mockReturnValue(of({ ok: true })),
    };
    dialogRef = { close: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ManagedServicesDialogComponent],
      providers: [
        { provide: ServiceService, useValue: serviceService },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ManagedServicesDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("loads available and managed services and detects orphaned ones", async () => {
    await fixture.whenStable();
    expect(component.available()).toEqual(["nginx", "postgresql"]);
    expect(component.isManaged("postgresql")).toBe(true);
    expect(component.isOrphaned("ghost-svc")).toBe(true);
    expect(component.isOrphaned("nginx")).toBe(false);
    expect(component.loading()).toBe(false);
  });

  it("sorts all services and filters by name", async () => {
    await fixture.whenStable();
    expect(component.filteredServices).toEqual(["ghost-svc", "nginx", "postgresql"]);
    component.filter.set("nginx");
    expect(component.filteredServices).toEqual(["nginx"]);
    component.filter.set("zzz");
    expect(component.filteredServices).toEqual([]);
  });

  it("adds a service via the API and updates local state", async () => {
    await fixture.whenStable();
    await component.toggle("nginx");
    expect(serviceService.addManagedService).toHaveBeenCalledWith("nginx");
    expect(component.isManaged("nginx")).toBe(true);
  });

  it("removes a service via the API and updates local state", async () => {
    await fixture.whenStable();
    await component.toggle("postgresql");
    expect(serviceService.removeManagedService).toHaveBeenCalledWith("postgresql");
    expect(component.isManaged("postgresql")).toBe(false);
  });

  it("closes with a positive result", () => {
    component.close();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });
});
