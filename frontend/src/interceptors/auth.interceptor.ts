import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, throwError } from "rxjs";
import { AuthService } from "../services/auth.service";

/**
 * Attach JWT token to every HTTP request (except login).
 * On 401 — clear the token and notify auth state.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  const isLogin = req.url.includes("/api/auth/login");

  const authReq = token && !isLogin ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((err: any) => {
      if (err.status === 401 && !isLogin) {
        authService.logout();
      }
      return throwError(() => err);
    }),
  );
};
