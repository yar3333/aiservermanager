import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface PamModule {
  authenticate(
    username: string,
    password: string,
    callback: (err: Error | null, userInfo: any) => void,
    options?: { serviceName?: string },
  ): void;
}

const pam: PamModule = require("authenticate-pam");

const CONFIG_DIR = path.join(os.homedir(), ".config", "aiservermanager");
const SECRET_FILE = path.join(CONFIG_DIR, "auth-secret");

/**
 * Authentication service: password verification via PAM + JWT token generation.
 *
 * Uses `authenticate-pam` to verify the system password through the PAM stack
 * (the standard Linux authentication mechanism).
 * JWT secret is persisted to ~/.config/aiservermanager/auth-secret so that
 * tokens remain valid across server restarts.
 *
 * Brute-force protection:
 * - Per-IP rate limit: max 10 login attempts per minute
 * - Account lockout: after 5 consecutive failures → locked for 15 minutes
 */
export class AuthService {
  private jwtSecret: string;
  private username: string;

  // Brute-force protection state
  private readonly failedByIp = new Map<string, number[]>(); // IP → sorted timestamps
  private readonly maxAttempts = 10;
  private readonly windowMs = 60_000; // 1 minute
  private readonly consecutiveLimit = 5;
  private readonly lockoutMs = 15 * 60 * 1000; // 15 min
  private readonly LOCKOUT_FILE = path.join(CONFIG_DIR, "lockout.json");
  private _consecutiveFails = 0;
  private _lockoutUntil = 0;

  constructor() {
    this.jwtSecret = this.loadOrCreateSecret();
    this.username = os.userInfo().username;
    this.loadLockoutState();
    // Cleanup stale entries every 5 min
    setInterval(() => this.cleanupStale(), 5 * 60 * 1000);
  }

  /**
   * Check if an IP is rate-limited. Returns null or { retryAfter: seconds }.
   */
  checkRateLimit(ip: string): { retryAfter: number } | null {
    const now = Date.now();

    // Global lockout
    if (now < this._lockoutUntil) {
      return { retryAfter: Math.ceil((this._lockoutUntil - now) / 1000) };
    }

    // Per-IP rate limit
    const timestamps = this.failedByIp.get(ip) ?? [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxAttempts) {
      const oldest = Math.min(...recent);
      return { retryAfter: Math.ceil((oldest + this.windowMs - now) / 1000) };
    }

    return null;
  }

  /**
   * Verify system password and return a JWT token, or null on failure.
   * Rate limit is checked by the route BEFORE this method is called.
   */
  async login(ip: string, password: string): Promise<string | null> {
    if (!password) return null;

    // Timing-safe: verify lockout BEFORE touching PAM
    // (route already checks rateLimit, but this is belt-and-suspenders)
    if (Date.now() < this._lockoutUntil) {
      this.recordAttempt(ip);
      return null;
    }

    const valid = await this.verifyPassword(password);

    if (valid) {
      // Success — reset lockout state
      this._consecutiveFails = 0;
      this._lockoutUntil = 0;
      this.persistLockoutState();
      return this.generateToken();
    }

    // Failure — record for rate limit + update lockout
    this.recordAttempt(ip);
    this._consecutiveFails++;
    if (this._consecutiveFails >= this.consecutiveLimit) {
      this._lockoutUntil = Date.now() + this.lockoutMs;
      console.warn(`[AuthService] Account locked for 15 min after ${this._consecutiveFails} consecutive failures`);
    }
    this.persistLockoutState();
    return null;
  }

  /** Verify a JWT token and return the decoded payload. */
  verifyToken(token: string): { username: string } | null {
    try {
      const decoded = this.signToken(token, true);
      return { username: decoded.username };
    } catch {
      return null;
    }
  }

  // ── Password verification ──

  /**
   * Verify password through PAM using the 'login' service.
   * This uses the same authentication stack as system login.
   */
  private verifyPassword(password: string): Promise<boolean> {
    return new Promise((resolve) => {
      pam.authenticate(
        this.username,
        password,
        (err: Error | null, _userInfo: any) => {
          if (err) {
            console.error(`[AuthService] PAM auth failed for ${this.username}: ${err.message}`);
            resolve(false);
            return;
          }
          console.log(`[AuthService] PAM auth successful for ${this.username}`);
          resolve(true);
        },
        { serviceName: "login" },
      );
    });
  }

  // ── Brute-force tracking ──

  private recordAttempt(ip: string): void {
    const now = Date.now();
    const timestamps = this.failedByIp.get(ip) ?? [];
    timestamps.push(now);
    this.failedByIp.set(ip, timestamps);
  }

  private cleanupStale(): void {
    const now = Date.now();
    for (const [ip, timestamps] of this.failedByIp.entries()) {
      const pruned = timestamps.filter((t) => now - t < this.windowMs);
      if (pruned.length === 0) {
        this.failedByIp.delete(ip);
      } else {
        this.failedByIp.set(ip, pruned);
      }
    }
  }

  private persistLockoutState(): void {
    try {
      fs.writeFileSync(
        this.LOCKOUT_FILE,
        JSON.stringify({ consecutiveFails: this._consecutiveFails, lockoutUntil: this._lockoutUntil }),
        "utf-8",
      );
    } catch (err) {
      console.error("[AuthService] Failed to persist lockout state:", err);
    }
  }

  private loadLockoutState(): void {
    try {
      const raw = fs.readFileSync(this.LOCKOUT_FILE, "utf-8");
      const data = JSON.parse(raw) as { consecutiveFails?: number; lockoutUntil?: number };
      if (typeof data.consecutiveFails === "number") this._consecutiveFails = data.consecutiveFails;
      if (typeof data.lockoutUntil === "number") this._lockoutUntil = data.lockoutUntil;
      // If lockout expired while server was down, reset
      if (Date.now() >= this._lockoutUntil) {
        this._consecutiveFails = 0;
        this._lockoutUntil = 0;
      }
    } catch {
      // File doesn't exist yet — normal on first run
    }
  }

  // ── JWT ──

  private generateToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ username: this.username, iat: now, exp: now + 7 * 24 * 60 * 60 }),
    ).toString("base64url");
    const signature = this.computeHmac(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  private signToken(token: string, _verifyOnly?: boolean): { username: string } {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token format");
    const signature = this.computeHmac(`${parts[0]}.${parts[1]}`);
    if (parts[2] !== signature) throw new Error("Invalid signature");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error("Token expired");
    return payload;
  }

  private computeHmac(data: string): string {
    return crypto.createHmac("sha256", this.jwtSecret).update(data).digest("base64url");
  }

  // ── JWT secret persistence ──

  private loadOrCreateSecret(): string {
    if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;

    try {
      const existing = fs.readFileSync(SECRET_FILE, "utf-8").trim();
      if (existing.length > 0) return existing;
    } catch {
      // File doesn't exist yet
    }

    const secret = crypto.randomBytes(32).toString("hex");
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  }
}
