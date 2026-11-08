import { Injectable, inject, signal } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { BehaviorSubject, firstValueFrom } from "rxjs";

const TOKEN_KEY = "asm_token";

export type LoginOutcome = { ok: true } | { ok: false; message: string };

/**
 * What the backend said the login failure was. A 503 means the password check
 * could not run at all (no account configured on the backend, PAM missing), and
 * saying so beats reporting a wrong password while nothing was wrong with it.
 */
function loginFailureMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse && typeof err.error?.error === "string") return err.error.error;
  return "Invalid password";
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private http = inject(HttpClient);

  /** Reactively notify the whole app when auth state changes (login/logout/401). */
  readonly authState = new BehaviorSubject<boolean>(this.hasToken());

  async login(password: string): Promise<LoginOutcome> {
    try {
      const res = await firstValueFrom(this.http.post<{ token: string }>("/api/auth/login", { password }));
      localStorage.setItem(TOKEN_KEY, res.token);
      this.authState.next(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: loginFailureMessage(err) };
    }
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.authState.next(false);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return this.hasToken();
  }

  private hasToken(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  }
}
