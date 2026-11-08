// Mock fs first — AuthService imports it at module level
const mockWriteFileSync: { calls: any[][] } = { calls: [] };
const mockReadFileSync: { calls: any[][]; values: Map<string, string> } = {
  calls: [],
  values: new Map(),
};
const mockMkdirSync: { calls: any[][] } = { calls: [] };

jest.mock("fs", () => ({
  writeFileSync: jest.fn((...args: any[]) => {
    mockWriteFileSync.calls.push(args);
  }),
  readFileSync: jest.fn((path: string, _enc?: string) => {
    mockReadFileSync.calls.push([path, _enc]);
    const val = mockReadFileSync.values.get(path);
    if (val === undefined) {
      const err: NodeJS.ErrnoException = new Error("ENOENT: no such file");
      err.code = "ENOENT";
      throw err;
    }
    return val;
  }),
  mkdirSync: jest.fn((...args: any[]) => {
    mockMkdirSync.calls.push(args);
  }),
}));

// Mock os so we can control userInfo
jest.mock("os", () => {
  const actual = jest.requireActual("os");
  return {
    ...actual,
    userInfo: () => ({ username: "testuser" }),
    hostname: () => "workstation",
  };
});

import { AuthService } from "../authService";
import { PasswordVerifier, VerifyOutcome } from "../auth/passwordVerifier";

// ── Helpers ──

function createMockVerifier(outcome: VerifyOutcome): PasswordVerifier {
  return {
    verify: jest.fn(() => Promise.resolve(outcome)),
  };
}

function createAuthService(verifier?: PasswordVerifier): AuthService {
  return new AuthService(verifier ?? createMockVerifier({ status: "denied" }));
}

// ── Tests ──

beforeEach(() => {
  jest.useFakeTimers();
  mockWriteFileSync.calls.length = 0;
  mockReadFileSync.calls.length = 0;
  mockReadFileSync.values.clear();
  mockMkdirSync.calls.length = 0;
  // The token names the account whose password opened the dashboard.
  process.env.AUTH_USER = "testuser";
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.AUTH_USER;
});

describe("AuthService brute-force protection", () => {
  let authService: AuthService;
  let mockVerifier: PasswordVerifier & { verify: jest.Mock };

  beforeEach(() => {
    mockVerifier = {
      verify: jest.fn(() => Promise.resolve({ status: "denied" } as VerifyOutcome)),
    } as unknown as PasswordVerifier & { verify: jest.Mock };
    authService = createAuthService(mockVerifier);
  });

  describe("checkRateLimit", () => {
    it("allows requests when under the limit", () => {
      expect(authService.checkRateLimit("1.2.3.4")).toBeNull();
    });
  });

  describe("login with rate limiting", () => {
    it("records failed attempts per IP", async () => {
      for (let i = 0; i < 5; i++) {
        expect(await authService.login("192.168.1.1", "wrong")).toEqual({ error: "invalid" });
      }

      // After 5 consecutive failures the account is locked
      const limit = authService.checkRateLimit("192.168.1.1");
      expect(limit).not.toBeNull();
      expect(limit!.retryAfter).toBeGreaterThan(0);
    });

    it("resets consecutive failures on success", async () => {
      for (let i = 0; i < 4; i++) {
        await authService.login("192.168.1.1", "wrong");
      }

      // 5th succeeds — reset
      mockVerifier.verify.mockResolvedValue({ status: "ok" });
      const result = await authService.login("192.168.1.1", "correct");
      expect("token" in result).toBe(true);
    });

    it("returns invalid during lockout without calling verifier", async () => {
      // Trigger lockout with 5 failures
      for (let i = 0; i < 5; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      // Clear mock to verify it's NOT called during lockout
      mockVerifier.verify.mockClear();

      const result = await authService.login("10.0.0.1", "anything");
      expect(result).toEqual({ error: "invalid" });
      expect(mockVerifier.verify).not.toHaveBeenCalled();
    });

    it("per-IP rate limit is independent per IP", async () => {
      // Fill up IP A's rate limit (10 attempts)
      for (let i = 0; i < 10; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      // IP A should be rate-limited
      const limitA = authService.checkRateLimit("10.0.0.1");
      expect(limitA).not.toBeNull();
    });
  });

  describe("a verifier that could not run", () => {
    it("reports it as unavailable instead of a wrong password", async () => {
      mockVerifier.verify.mockResolvedValue({ status: "error", message: "AUTH_USER is not set" });

      expect(await authService.login("1.2.3.4", "whatever")).toEqual({
        error: "unavailable",
        message: "AUTH_USER is not set",
      });
    });

    it("spends neither the lockout nor the per-IP budget on it", async () => {
      // A misconfigured backend used to lock the operator out after 5 timeouts
      // of a check that never compared a single password.
      for (let i = 0; i < 8; i++) {
        mockVerifier.verify.mockResolvedValue({ status: "error", message: "verifier timed out" });
        await authService.login("10.0.0.1", "whatever");
      }

      expect(authService.checkRateLimit("10.0.0.1")).toBeNull();

      mockVerifier.verify.mockResolvedValue({ status: "ok" });
      expect("token" in (await authService.login("10.0.0.1", "correct"))).toBe(true);
    });
  });

  describe("lockout state stays in memory", () => {
    it("writes nothing to disk on a failed login", async () => {
      // A persisted counter costs a write per miss and turns the lockout into a
      // 15-minute DoS that restarting the service cannot clear.
      for (let i = 0; i < 6; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      const written = mockWriteFileSync.calls.map((call) => String(call[0]));
      expect(written.filter((target) => target.includes("lockout"))).toEqual([]);
    });

    it("starts clean in a new instance, which is what makes a restart a way out", async () => {
      for (let i = 0; i < 5; i++) {
        await authService.login("10.0.0.1", "wrong");
      }
      expect(authService.checkRateLimit("10.0.0.1")).not.toBeNull();

      const fresh = createAuthService(createMockVerifier({ status: "ok" }));
      expect(fresh.checkRateLimit("10.0.0.1")).toBeNull();
    });

    it("still locks out and clears the lockout after the window", async () => {
      for (let i = 0; i < 5; i++) {
        await authService.login("10.0.0.1", "wrong");
      }
      expect(authService.checkRateLimit("10.0.0.1")?.retryAfter).toBeGreaterThan(0);

      jest.advanceTimersByTime(15 * 60 * 1000 + 1);
      expect(authService.checkRateLimit("10.0.0.1")).toBeNull();
    });

    it("resets the consecutive counter on a successful login", async () => {
      for (let i = 0; i < 4; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      mockVerifier.verify.mockResolvedValue({ status: "ok" });
      await authService.login("10.0.0.1", "correct");

      for (let i = 0; i < 4; i++) {
        mockVerifier.verify.mockResolvedValue({ status: "denied" });
        await authService.login("10.0.0.1", "wrong");
      }
      // 4 + 4 misses with a success between them: never five in a row.
      expect(authService.checkRateLimit("192.168.9.9")).toBeNull();
    });
  });

  describe("JWT token", () => {
    it("generates valid JWT on successful login", async () => {
      mockVerifier.verify.mockResolvedValue({ status: "ok" });

      const result = await authService.login("1.2.3.4", "correct");
      if (!("token" in result)) throw new Error(`expected a token, got ${JSON.stringify(result)}`);
      expect(typeof result.token).toBe("string");
      expect(result.token.split(".")).toHaveLength(3);
    });

    it("verifies valid token", async () => {
      mockVerifier.verify.mockResolvedValue({ status: "ok" });

      const result = await authService.login("1.2.3.4", "correct");
      if (!("token" in result)) throw new Error(`expected a token, got ${JSON.stringify(result)}`);
      const payload = authService.verifyToken(result.token);
      expect(payload).not.toBeNull();
      expect(payload!.username).toBe("testuser");
    });

    it("rejects tampered token", () => {
      expect(authService.verifyToken("header.tampered.sig")).toBeNull();
    });
  });

  describe("verifier delegation", () => {
    it("calls verifier.verify with the password", async () => {
      await authService.login("1.2.3.4", "secret");
      expect(mockVerifier.verify).toHaveBeenCalledWith("secret");
    });

    it("returns invalid on empty password without calling verifier", async () => {
      const result = await authService.login("1.2.3.4", "");
      expect(result).toEqual({ error: "invalid" });
      expect(mockVerifier.verify).not.toHaveBeenCalled();
    });
  });
});
