import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ServiceService } from "./service.service";
import { ServiceConfig, ServiceStatus } from "../models/service";

const STATUS: ServiceStatus = { name: "llama-server", running: true, enabled: true, installed: true };
const CONFIG: ServiceConfig = {
  name: "llama-server",
  type: "llama-server",
  command: "/bin/llama-server",
  flags: ["--model m.gguf"],
};

describe("ServiceService", () => {
  let service: ServiceService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ServiceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("fetches service statuses from /api/services", () => {
    service.fetchServices().subscribe((result) => expect(result).toEqual([STATUS]));
    const req = httpMock.expectOne("/api/services");
    expect(req.request.method).toBe("GET");
    req.flush([STATUS]);
  });

  it("posts a control action with name and action", () => {
    service.control("llama-server", "stop").subscribe((result) => expect(result).toEqual(STATUS));
    const req = httpMock.expectOne("/api/services/control");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ name: "llama-server", action: "stop" });
    req.flush(STATUS);
  });

  it("fetches configs and a single config", () => {
    service.fetchConfigs().subscribe((result) => expect(result).toEqual([CONFIG]));
    httpMock.expectOne("/api/services/config").flush([CONFIG]);

    service.getConfig("llama-server").subscribe((result) => expect(result).toEqual(CONFIG));
    httpMock.expectOne("/api/services/config/llama-server").flush(CONFIG);
  });

  it("saves a config via POST", () => {
    service.saveConfig(CONFIG).subscribe((result) => expect(result).toEqual(CONFIG));
    const req = httpMock.expectOne("/api/services/config");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual(CONFIG);
    req.flush(CONFIG);
  });

  it("deletes a config via DELETE", () => {
    service.deleteConfig("llama-server").subscribe((result) => expect(result).toEqual({ ok: true }));
    const req = httpMock.expectOne("/api/services/config/llama-server");
    expect(req.request.method).toBe("DELETE");
    req.flush({ ok: true });
  });

  it("lists available and managed services", () => {
    service.listAvailableServices().subscribe((result) => expect(result).toEqual(["nginx"]));
    httpMock.expectOne("/api/services/managed/available").flush(["nginx"]);

    service.listManagedServices().subscribe((result) => expect(result).toEqual(["nginx"]));
    httpMock.expectOne("/api/services/managed").flush(["nginx"]);
  });

  it("adds and removes a managed service", () => {
    service.addManagedService("nginx").subscribe((result) => expect(result).toEqual({ ok: true }));
    const addReq = httpMock.expectOne("/api/services/managed");
    expect(addReq.request.method).toBe("POST");
    expect(addReq.request.body).toEqual({ name: "nginx" });
    addReq.flush({ ok: true });

    service.removeManagedService("nginx").subscribe((result) => expect(result).toEqual({ ok: true }));
    const delReq = httpMock.expectOne("/api/services/managed");
    expect(delReq.request.method).toBe("DELETE");
    expect(delReq.request.body).toEqual({ name: "nginx" });
    delReq.flush({ ok: true });
  });

  it("fetches journal lines with the lines param", () => {
    const lines = [{ timestamp: "12:00", message: "loaded model" }];
    service.fetchJournal("llama-server", 50).subscribe((result) => expect(result).toEqual(lines));
    const req = httpMock.expectOne("/api/services/journal/llama-server?lines=50");
    expect(req.request.method).toBe("GET");
    req.flush(lines);
  });

  it("requests llama autocomplete with type/query/binary params", () => {
    const suggestions = [{ path: "/dev/nvidia0", source: "device" }];
    service
      .getLlamaAutocomplete("device", "", "/bin/llama-server")
      .subscribe((result) => expect(result).toEqual(suggestions));
    const req = httpMock.expectOne(
      (r) =>
        r.url === "/api/services/llama/autocomplete" &&
        r.params.get("type") === "device" &&
        r.params.get("query") === "" &&
        r.params.get("binary") === "/bin/llama-server",
    );
    expect(req.request.method).toBe("GET");
    req.flush(suggestions);
  });

  it("omits the binary param when not provided", () => {
    service.getLlamaAutocomplete("host", "127.0").subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url === "/api/services/llama/autocomplete" &&
        r.params.get("type") === "host" &&
        r.params.get("query") === "127.0" &&
        r.params.get("binary") === null,
    );
    expect(req.request.method).toBe("GET");
    req.flush([]);
  });
});
