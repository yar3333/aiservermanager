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
  };
});

// Mock authenticate-pam
jest.mock("authenticate-pam", () => ({
  authenticate: jest.fn(),
}));

const mockPam = require("authenticate-pam") as {
  authenticate: jest.Mock;
};

let AuthService: typeof import("../authService").AuthService;

beforeAll(() => {
  delete require.cache[require.resolve("../authService")];
  ({ AuthService } = require("../authService"));
});

beforeEach(() => {
  jest.useFakeTimers();
  mockPam.authenticate.mockClear();
  mockWriteFileSync.calls.length = 0;
  mockReadFileSync.calls.length = 0;
  mockReadFileSync.values.clear();
  mockMkdirSync.calls.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("AuthService brute-force protection", () => {
  let authService: InstanceType<typeof AuthService>;

  function createAuthService() {
    delete require.cache[require.resolve("../authService")];
    const mod = require("../authService");
    return new mod.AuthService();
  }

  beforeEach(() => {
    authService = createAuthService();
  });

  describe("checkRateLimit", () => {
    it("allows requests when under the limit", () => {
      expect(authService.checkRateLimit("1.2.3.4")).toBeNull();
    });
  });

  describe("login with rate limiting", () => {
    it("records failed attempts per IP", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(new Error("auth failed"), null);
      });

      for (let i = 0; i < 5; i++) {
        expect(await authService.login("192.168.1.1", "wrong")).toBeNull();
      }

      // After 5 consecutive failures the account is locked
      const limit = authService.checkRateLimit("192.168.1.1");
      expect(limit).not.toBeNull();
      expect(limit!.retryAfter).toBeGreaterThan(0);
    });

    it("resets consecutive failures on success", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(new Error("auth failed"), null);
      });

      for (let i = 0; i < 4; i++) {
        await authService.login("192.168.1.1", "wrong");
      }

      // 5th succeeds — reset
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(null, { user: "testuser" });
      });

      const token = await authService.login("192.168.1.1", "correct");
      expect(token).not.toBeNull();
    });

    it("returns null during lockout without calling PAM", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(new Error("auth failed"), null);
      });

      // Trigger lockout with 5 failures
      for (let i = 0; i < 5; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      // Clear PAM mock to verify it's NOT called during lockout
      mockPam.authenticate.mockClear();

      const result = await authService.login("10.0.0.1", "anything");
      expect(result).toBeNull();
      expect(mockPam.authenticate).not.toHaveBeenCalled();
    });

    it("per-IP rate limit is independent per IP", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(new Error("auth failed"), null);
      });

      // Fill up IP A's rate limit (10 attempts)
      for (let i = 0; i < 10; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      // IP A should be rate-limited
      const limitA = authService.checkRateLimit("10.0.0.1");
      expect(limitA).not.toBeNull();
    });
  });

  describe("lockout persistence", () => {
    it("persists lockout state to file after failure", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(new Error("auth failed"), null);
      });

      for (let i = 0; i < 5; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      expect(mockWriteFileSync.calls.length).toBeGreaterThan(0);
      const lastCall = mockWriteFileSync.calls[mockWriteFileSync.calls.length - 1];
      const data = JSON.parse(lastCall[1] as string);
      expect(data.consecutiveFails).toBe(5);
      expect(data.lockoutUntil).toBeGreaterThan(0);
    });

    it("resets lockout state on successful login", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(new Error("auth failed"), null);
      });

      for (let i = 0; i < 3; i++) {
        await authService.login("10.0.0.1", "wrong");
      }

      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(null, { user: "testuser" });
      });
      await authService.login("10.0.0.1", "correct");

      const lastData = JSON.parse(mockWriteFileSync.calls[mockWriteFileSync.calls.length - 1][1] as string);
      expect(lastData.consecutiveFails).toBe(0);
      expect(lastData.lockoutUntil).toBe(0);
    });
  });

  describe("JWT token", () => {
    it("generates valid JWT on successful login", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(null, { user: "testuser" });
      });

      const token = await authService.login("1.2.3.4", "correct");
      expect(token).not.toBeNull();
      expect(typeof token).toBe("string");
      expect(token!.split(".")).toHaveLength(3);
    });

    it("verifies valid token", async () => {
      mockPam.authenticate.mockImplementation((_u: string, _p: string, cb: any) => {
        cb(null, { user: "testuser" });
      });

      const token = await authService.login("1.2.3.4", "correct");
      const payload = authService.verifyToken(token!);
      expect(payload).not.toBeNull();
      expect(payload!.username).toBe("testuser");
    });

    it("rejects tampered token", () => {
      expect(authService.verifyToken("header.tampered.sig")).toBeNull();
    });
  });
});
