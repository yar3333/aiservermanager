import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("stores the token and emits authState on successful login", async () => {
    const promise = service.login("secret");

    const req = httpMock.expectOne("/api/auth/login");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ password: "secret" });
    req.flush({ token: "abc123" });

    await expect(promise).resolves.toBe(true);
    expect(localStorage.getItem("asm_token")).toBe("abc123");
    expect(service.getToken()).toBe("abc123");
    expect(service.isAuthenticated()).toBe(true);
    expect(service.authState.value).toBe(true);
  });

  it("returns false and keeps auth state on failed login", async () => {
    const promise = service.login("wrong");

    httpMock.expectOne("/api/auth/login").error(new ProgressEvent("error"));

    await expect(promise).resolves.toBe(false);
    expect(service.isAuthenticated()).toBe(false);
    expect(service.authState.value).toBe(false);
  });

  it("logout clears the token and notifies subscribers", () => {
    localStorage.setItem("asm_token", "abc123");
    service.logout();
    expect(localStorage.getItem("asm_token")).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.authState.value).toBe(false);
  });

  it("reports auth state from a token stored before creation", () => {
    expect(service.isAuthenticated()).toBe(false);
    localStorage.setItem("asm_token", "abc123");

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fresh = TestBed.inject(AuthService);
    expect(fresh.isAuthenticated()).toBe(true);
    expect(fresh.authState.value).toBe(true);
  });
});
