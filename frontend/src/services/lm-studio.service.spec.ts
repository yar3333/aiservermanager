import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { LmStudioService } from "./lm-studio.service";
import { LmStudioModel } from "../models/lm-studio";

describe("LmStudioService", () => {
  let service: LmStudioService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LmStudioService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("fetches local models from /api/lmstudio/models", async () => {
    const models: LmStudioModel[] = [
      {
        name: "lmstudio-community/Test-Model-GGUF",
        dir: "/root/models/lmstudio-community/Test-Model-GGUF",
        size: 4096,
        files: [{ name: "Model-Q4_K_M.gguf", size: 2048 }],
      },
    ];
    const promise = service.getModels();
    const req = httpMock.expectOne("/api/lmstudio/models");
    expect(req.request.method).toBe("GET");
    req.flush(models);
    await expect(promise).resolves.toEqual(models);
  });

  it("deletes a model via DELETE /api/lmstudio/models/:org/:name", async () => {
    const promise = service.deleteModel("pub/model");
    const req = httpMock.expectOne("/api/lmstudio/models/pub/model");
    expect(req.request.method).toBe("DELETE");
    req.flush({});
    await expect(promise).resolves.toBeUndefined();
  });

  it("deletes a single quantization file via DELETE /api/lmstudio/models/:org/:name/files/:file", async () => {
    const promise = service.deleteModelFile("pub/model", "Model-Q4_K_M.gguf");
    const req = httpMock.expectOne("/api/lmstudio/models/pub/model/files/Model-Q4_K_M.gguf");
    expect(req.request.method).toBe("DELETE");
    req.flush({});
    await expect(promise).resolves.toBeUndefined();
  });
});
