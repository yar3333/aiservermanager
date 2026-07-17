import request from "supertest";
import express from "express";
import { Container } from "inversify";
import authRoutes from "../authRoutes";
import { AUTH_SERVICE } from "../../di/types";
import { AuthService } from "../../services/authService";

describe("Auth routes", () => {
  let app: express.Express;
  let container: Container;
  let mockAuthService: AuthService;

  beforeEach(() => {
    mockAuthService = {
      login: jest.fn(),
      checkRateLimit: jest.fn(() => null),
      verifyToken: jest.fn(),
    } as unknown as AuthService;

    container = new Container();
    container.bind<AuthService>(AUTH_SERVICE).toConstantValue(mockAuthService);

    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes(container));
  });

  describe("POST /api/auth/login", () => {
    it("returns 400 when password is missing", async () => {
      const res = await request(app).post("/api/auth/login").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Password is required");
    });

    it("returns 401 when password is invalid", async () => {
      (mockAuthService as any).login.mockResolvedValue(null);
      const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid password");
    });

    it("returns 200 with token when password is valid", async () => {
      (mockAuthService as any).login.mockResolvedValue("fake-jwt-token");
      const res = await request(app).post("/api/auth/login").send({ password: "correct" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBe("fake-jwt-token");
    });

    it("returns 429 when rate limited", async () => {
      (mockAuthService as any).checkRateLimit.mockReturnValue({ retryAfter: 42 });
      const res = await request(app).post("/api/auth/login").send({ password: "anything" });
      expect(res.status).toBe(429);
      expect(res.body.error).toContain("Too many attempts");
      expect(res.body.retryAfter).toBe(42);
      // login must NOT be called when rate limited (timing-safe)
      expect((mockAuthService as any).login).not.toHaveBeenCalled();
    });

    it("passes client IP to login", async () => {
      (mockAuthService as any).login.mockResolvedValue("token");
      await request(app).post("/api/auth/login").set("X-Forwarded-For", "1.2.3.4, 5.6.7.8").send({ password: "test" });
      expect((mockAuthService as any).login).toHaveBeenCalledWith("1.2.3.4", "test");
    });

    it("uses req.ip when no X-Forwarded-For", async () => {
      (mockAuthService as any).login.mockResolvedValue("token");
      await request(app).post("/api/auth/login").send({ password: "test" });
      // req.ip from supertest is "::1" or "127.0.0.1"
      const [ip] = (mockAuthService as any).login.mock.calls[0];
      expect(typeof ip).toBe("string");
      expect(ip.length).toBeGreaterThan(0);
    });
  });
});
