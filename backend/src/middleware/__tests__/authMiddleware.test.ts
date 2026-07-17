import request from "supertest";
import express from "express";
import { Container } from "inversify";
import { authMiddleware } from "../authMiddleware";
import { AUTH_SERVICE } from "../../di/types";
import { AuthService } from "../../services/authService";

describe("Auth middleware", () => {
  let app: express.Express;
  let container: Container;
  let mockAuthService: AuthService;

  beforeEach(() => {
    mockAuthService = {
      verifyToken: jest.fn(),
    } as unknown as AuthService;

    container = new Container();
    container.bind<AuthService>(AUTH_SERVICE).toConstantValue(mockAuthService);

    app = express();
    app.use(authMiddleware(container));
    app.get("/test", (_req, res) => res.json({ ok: true }));
  });

  it("allows /health without auth", async () => {
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("returns 401 when no Authorization header", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Authorization header required");
  });

  it("returns 401 when Authorization format is invalid", async () => {
    const res = await request(app).get("/test").set("Authorization", "Basic abc123");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid authorization format");
  });

  it("returns 401 when token is invalid", async () => {
    (mockAuthService as any).verifyToken.mockReturnValue(null);
    const res = await request(app).get("/test").set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid or expired token");
  });

  it("passes through when token is valid", async () => {
    (mockAuthService as any).verifyToken.mockReturnValue({ username: "testuser" });
    const res = await request(app).get("/test").set("Authorization", "Bearer valid-token");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
