import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { HfService } from "./hf.service";
import { HfLocalModel } from "../models/hf";

describe("HfService", () => {
  let service: HfService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HfService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("fetches cached models from /api/hf/models", async () => {
    const models: HfLocalModel[] = [
      {
        name: "unsloth/Model-GGUF",
        dir: "/cache/hub/models--unsloth--Model-GGUF",
        size: 4096,
        files: [{ name: "UD-Q4_K_XL/model-UD-Q4_K_XL.gguf", size: 2048, shards: ["UD-Q4_K_XL/model-UD-Q4_K_XL-00001-of-00001.gguf"] }],
      },
    ];
    const promise = service.getLocalModels();
    const req = httpMock.expectOne("/api/hf/models");
    expect(req.request.method).toBe("GET");
    req.flush(models);
    await expect(promise).resolves.toEqual(models);
  });

  it("deletes a whole model via DELETE /api/hf/models/:org/:name", async () => {
    const promise = service.deleteLocalModel("org/model");
    const req = httpMock.expectOne("/api/hf/models/org/model");
    expect(req.request.method).toBe("DELETE");
    req.flush({});
    await expect(promise).resolves.toBeUndefined();
  });

  it("deletes one quantization via DELETE /api/hf/models/:org/:name/files/:file", async () => {
    const promise = service.deleteLocalModelFile("org/model", "model-Q4_K_M.gguf");
    const req = httpMock.expectOne("/api/hf/models/org/model/files/model-Q4_K_M.gguf");
    expect(req.request.method).toBe("DELETE");
    req.flush({});
    await expect(promise).resolves.toBeUndefined();
  });

  it("encodes slashes of a nested quantization path", async () => {
    const promise = service.deleteLocalModelFile("org/model", "UD-Q4_K_XL/model.gguf");
    const req = httpMock.expectOne("/api/hf/models/org/model/files/UD-Q4_K_XL%2Fmodel.gguf");
    expect(req.request.method).toBe("DELETE");
    req.flush({});
    await expect(promise).resolves.toBeUndefined();
  });
});
