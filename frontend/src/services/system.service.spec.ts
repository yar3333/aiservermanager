import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { SystemService } from "./system.service";
import { SystemInfoDetail } from "../models/gpu";

const INFO: SystemInfoDetail = {
  os: { name: "Ubuntu", version: "24.04", id: "ubuntu" },
  hostname: "gpu-box",
  kernel: "6.8.0",
  uptime: "3 days",
  disks: [],
  logs: [],
};

describe("SystemService", () => {
  let service: SystemService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SystemService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("posts to /api/system/reboot", async () => {
    const promise = service.reboot();
    const req = httpMock.expectOne("/api/system/reboot");
    expect(req.request.method).toBe("POST");
    req.flush(null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("posts to /api/system/shutdown", async () => {
    const promise = service.shutdown();
    const req = httpMock.expectOne("/api/system/shutdown");
    expect(req.request.method).toBe("POST");
    req.flush(null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("fetches system info from /api/system/info", async () => {
    const promise = service.getSystemInfo();
    httpMock.expectOne("/api/system/info").flush(INFO);
    await expect(promise).resolves.toEqual(INFO);
  });
});
