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

const WINDOWS_INFO: SystemInfoDetail = {
  ...INFO,
  os: { name: "Windows 11 Pro", version: "10.0.26100", id: "win32" },
  server: { pid: 4243, platform: "win32", host: "0.0.0.0", port: 4243, startedAt: "2026-11-07T03:00:00Z", privileged: true },
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

  it("publishes the backend platform as a signal", async () => {
    const promise = service.detectWindows();
    httpMock.expectOne("/api/system/info").flush(WINDOWS_INFO);

    await expect(promise).resolves.toBe(true);
    expect(service.platform()).toBe("win32");
    expect(service.windows()).toBe(true);
  });

  it("reads a backend without a server identity as Linux", async () => {
    const promise = service.detectWindows();
    httpMock.expectOne("/api/system/info").flush(INFO);

    await expect(promise).resolves.toBe(false);
    expect(service.windows()).toBe(false);
  });

  it("asks the backend about its platform once", async () => {
    const first = service.detectWindows();
    httpMock.expectOne("/api/system/info").flush(WINDOWS_INFO);
    await expect(first).resolves.toBe(true);

    await expect(service.detectWindows()).resolves.toBe(true);
    httpMock.expectNone("/api/system/info");
  });

  it("reads an unreachable backend as Linux and asks again later", async () => {
    const first = service.detectWindows();
    httpMock.expectOne("/api/system/info").flush("unavailable", { status: 503, statusText: "Service Unavailable" });
    await expect(first).resolves.toBe(false);

    const second = service.detectWindows();
    httpMock.expectOne("/api/system/info").flush(WINDOWS_INFO);
    await expect(second).resolves.toBe(true);
  });
});
