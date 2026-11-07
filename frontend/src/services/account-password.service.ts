import { Injectable, inject } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { firstValueFrom } from "rxjs";
import { ServiceConfig } from "../models/service";
import { SystemService } from "./system.service";
import { AccountPasswordDialogComponent } from "../components/services/account-password-dialog/account-password-dialog.component";

/**
 * Asks for the password of a run-as account at the moment a service is
 * registered. The backend keeps no copy of it, so the password lives here in
 * memory for the duration of one request and is dropped afterwards.
 */
@Injectable({ providedIn: "root" })
export class AccountPasswordService {
  private dialog = inject(MatDialog);
  private system = inject(SystemService);

  /**
   * @returns the typed password, `undefined` when the service runs without an
   * account, or `null` when the user cancelled and the action must not run.
   */
  async askFor(cfg: ServiceConfig | undefined): Promise<string | null | undefined> {
    if (!cfg?.user || !(await this.system.detectWindows())) return undefined;

    const ref = this.dialog.open(AccountPasswordDialogComponent, {
      data: { service: cfg.name, user: cfg.user },
      width: "460px",
    });
    const password = (await firstValueFrom(ref.afterClosed())) as string | undefined;
    return password || null;
  }
}
