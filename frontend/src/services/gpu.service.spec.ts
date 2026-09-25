import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { take } from "rxjs/operators";
import { GpuService } from "./gpu.service";
import { Gpu, GpuStatusResponse } from "../models/gpu";

const GPU: Gpu = {
  index: 0,
  vendor: "NVIDIA",
  brand: "MSI",
  name: "RTX 4090",
  gpuIndex: 0,
  vramTotal: 24,
  pciBusId: "01:00.0",
};

const STATUS: GpuStatusResponse = {
  gpus: [{ key: "01:00.0", usage: 50, temperature: 60, vramUsed: 12 }],
  system: { cpuUsage: 10, memoryTotal: 100, memoryUsed: 30, memoryPercent: 30 },
};

describe("GpuService", () => {
  let service: GpuService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(GpuService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("fetches static GPU info from /api/gpus", () => {
    service.fetchGpus().subscribe((result) => expect(result).toEqual([GPU]));
    const req = httpMock.expectOne("/api/gpus");
    expect(req.request.method).toBe("GET");
    req.flush([GPU]);
  });

  it("fetches unified status from /api/gpus/usage", () => {
    service.fetchStatus().subscribe((result) => expect(result).toEqual(STATUS));
    const req = httpMock.expectOne("/api/gpus/usage");
    expect(req.request.method).toBe("GET");
    req.flush(STATUS);
  });

  it("polls status immediately and then on the given interval", () => {
    jest.useFakeTimers();
    service
      .watchStatus(1000)
      .pipe(take(2))
      .subscribe();

    jest.advanceTimersByTime(0);
    httpMock.expectOne("/api/gpus/usage").flush(STATUS);

    jest.advanceTimersByTime(1000);
    httpMock.expectOne("/api/gpus/usage").flush(STATUS);

    jest.useRealTimers();
  });
});
