import { Component, Inject, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from "@angular/forms";
import { MatCardModule } from "@angular/material/card";
import { MatButtonModule } from "@angular/material/button";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { ServiceConfig } from "../../../models/service";

export interface ServiceDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
}

const SUFFIX_REGEX = "^[a-z0-9][a-z0-9-]{0,30}$";

@Component({
  selector: "app-service-dialog",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatIconModule,
    MatDialogModule,
  ],
  templateUrl: "./service-dialog.component.html",
  styleUrls: ["./service-dialog.component.scss"],
})
export class ServiceDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<ServiceDialogComponent>);
  private data: ServiceDialogData = inject(MAT_DIALOG_DATA);

  readonly isEdit = this.data.config !== null;

  form = this.fb.group({
    suffix: [
      this.data.config?.suffix ?? "",
      {
        validators: [Validators.required, Validators.pattern(SUFFIX_REGEX)],
        disabled: this.isEdit ? true : null,
      },
    ],
    command: [this.data.config?.command ?? "", Validators.required],
    flags: this.fb.array([] as any[]),
  });

  get suffixControl() {
    return this.form.get("suffix")!;
  }
  get commandControl() {
    return this.form.get("command")!;
  }
  get flagsArray(): FormArray {
    return this.form.get("flags") as FormArray;
  }

  ngOnInit(): void {
    // Seed flags from existing config
    if (this.data.config?.flags) {
      const entries = Object.entries(this.data.config.flags);
      for (const [key, value] of entries) {
        this.flagsArray.push(this.fb.group({ key: [key as string, Validators.required], value: [value as string] }));
      }
    } else {
      // Add one empty row by default
      this.addFlag();
    }
  }

  addFlag(): void {
    this.flagsArray.push(this.fb.group({ key: ["", Validators.required], value: [""] }));
  }

  removeFlag(index: number): void {
    this.flagsArray.removeAt(index);
  }

  save(): void {
    if (this.form.invalid) return;

    const flags: Record<string, string> = {};
    for (const ctrl of this.flagsArray.controls) {
      const g = ctrl as FormGroup;
      const k = g.get("key")?.value?.trim();
      const v = g.get("value")?.value?.trim() ?? "";
      if (k) flags[k] = v;
    }

    const cfg: ServiceConfig = {
      suffix: (this.suffixControl.value as string).trim(),
      command: (this.commandControl.value as string).trim(),
      flags,
    };

    this.dialogRef.close(cfg);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
