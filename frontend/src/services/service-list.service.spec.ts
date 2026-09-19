import { TestBed } from "@angular/core/testing";
import { of, throwError } from "rxjs";
import { ServiceListService } from "./service-list.service";
import { ServiceService } from "./service.service";
import { ServiceStatus } from "../models/service";

describe("ServiceListService", () => {
  let service: ServiceListService;
  let serviceService: { fetchServices: jest.Mock };

  const statuses: ServiceStatus[] = [
    { name: "nginx", running: true, enabled: true, installed: true },
    { name: "llama-server", running: false, enabled: false, installed: true },
  ];

  beforeEach(() => {
    serviceService = { fetchServices: jest.fn() };
    TestBed.configureTestingModule({
      providers: [ServiceListService, { provide: ServiceService, useValue: serviceService }],
    });
    service = TestBed.inject(ServiceListService);
  });

  it("publishes fetched services on a successful refresh", async () => {
    serviceService.fetchServices.mockReturnValue(of(statuses));

    await service.refresh();

    expect(service.services()).toEqual(statuses);
    expect(service.loaded()).toBe(true);
    expect(service.error()).toBeNull();
  });

  it("records the error and stays unloaded when the fetch fails", async () => {
    serviceService.fetchServices.mockReturnValue(throwError(() => new Error("boom")));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await service.refresh();

    expect(service.services()).toEqual([]);
    expect(service.loaded()).toBe(false);
    expect(service.error()).toBe("boom");

    errorSpy.mockRestore();
  });
});
