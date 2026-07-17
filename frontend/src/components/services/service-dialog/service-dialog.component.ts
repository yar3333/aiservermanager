import { Component, Inject, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { ServiceConfig } from "../../../models/service";

export interface ServiceDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
}

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

@Component({
  selector: "app-service-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatButtonModule, MatInputModule, MatDialogModule],
  templateUrl: "./service-dialog.component.html",
  styleUrls: ["./service-dialog.component.scss"],
})
export class ServiceDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<ServiceDialogComponent>);
  private data: ServiceDialogData = inject(MAT_DIALOG_DATA);

  readonly isEdit = this.data.config !== null;

  form = this.fb.group({
    name: [this.data.config?.name ?? "", { validators: [Validators.required, Validators.pattern(NAME_REGEX)] }],
    command: [this.data.config?.command ?? "", Validators.required],
    flagsText: [""],
  });

  get nameControl() {
    return this.form.get("name")!;
  }
  get commandControl() {
    return this.form.get("command")!;
  }

  ngOnInit(): void {
    if (this.data.config?.flags) {
      this.form.get("flagsText")!.setValue(this.data.config.flags.join("\n"));
    }
  }

  save(): void {
    if (this.form.invalid) return;

    const flags: string[] = [];
    for (const line of (this.form.get("flagsText")!.value as string).split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        flags.push(trimmed);
      }
    }

    const cfg: ServiceConfig = {
      name: (this.nameControl.value as string).trim(),
      command: (this.commandControl.value as string).trim(),
      flags,
    };

    this.dialogRef.close(cfg);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
