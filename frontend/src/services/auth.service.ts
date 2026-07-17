import { Injectable, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { BehaviorSubject, firstValueFrom } from "rxjs";

const TOKEN_KEY = "asm_token";

@Injectable({ providedIn: "root" })
export class AuthService {
  private http = inject(HttpClient);

  /** Reactively notify the whole app when auth state changes (login/logout/401). */
  readonly authState = new BehaviorSubject<boolean>(this.hasToken());

  async login(password: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(this.http.post<{ token: string }>("/api/auth/login", { password }));
      localStorage.setItem(TOKEN_KEY, res.token);
      this.authState.next(true);
      return true;
    } catch {
      return false;
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
