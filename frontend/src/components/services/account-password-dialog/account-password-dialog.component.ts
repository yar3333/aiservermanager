import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";

export interface AccountPasswordDialogData {
  /** Service being registered. */
  service: string;
  /** Account the service will run as. */
  user: string;
}

/**
 * Asks for the password of the run-as account at the moment the service is
 * registered. The value is handed to the installer once and kept nowhere — not
 * in the service config, and not in this dialog after it closes.
 */
@Component({
  selector: "app-account-password-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatInputModule, MatDialogModule],
  templateUrl: "./account-password-dialog.component.html",
  styleUrls: ["./account-password-dialog.component.scss"],
})
export class AccountPasswordDialogComponent {
  private dialogRef = inject(MatDialogRef<AccountPasswordDialogComponent>);
  private data: AccountPasswordDialogData = inject(MAT_DIALOG_DATA);

  readonly service = this.data.service;
  readonly user = this.data.user;

  password = "";

  submit(): void {
    if (!this.password) return;
    this.dialogRef.close(this.password);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
