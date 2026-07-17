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
 */
export class AuthService {
  private jwtSecret: string;
  private username: string;

  constructor() {
    this.jwtSecret = this.loadOrCreateSecret();
    this.username = os.userInfo().username;
  }

  /** Verify system password and return a JWT token, or null on failure. */
  async login(password: string): Promise<string | null> {
    if (!password) return null;
    const valid = await this.verifyPassword(password);
    if (!valid) return null;
    return this.generateToken();
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
