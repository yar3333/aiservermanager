import { Component, Inject, inject, computed, OnInit, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatButtonModule } from "@angular/material/button";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { ServiceConfig, ServiceType } from "../../../models/service";

export interface ServiceDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select). */
  allConfigs?: ServiceConfig[];
  /** Clone mode: prefill from an existing config but create a new service (name stays editable). */
  clone?: boolean;
}

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

@Component({
  selector: "app-service-dialog",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatInputModule,
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
  readonly isClone = this.data.clone === true;

  form = this.fb.group({
    name: [this.data.config?.name ?? "", { validators: [Validators.required, Validators.pattern(NAME_REGEX)] }],
    command: [this.data.config?.command ?? "", Validators.required],
    flagsText: [""],
    envText: [""],
  });

  get nameControl() {
    return this.form.get("name")!;
  }
  get commandControl() {
    return this.form.get("command")!;
  }

  /** All unique commands from other configs (excludes current in edit mode). */
  readonly allExistingCommands = computed<{ command: string; from: string }[]>(() => {
    const all = this.data.allConfigs ?? [];
    const currentName = this.data.config?.name ?? null;
    const seen = new Set<string>();
    const result: { command: string; from: string }[] = [];
    for (const cfg of all) {
      if (cfg.name === currentName) continue;
      if (!seen.has(cfg.command)) {
        seen.add(cfg.command);
        result.push({ command: cfg.command, from: cfg.name });
      }
    }
    return result;
  });

  /** Command input value as a signal (for reactive filtering). */
  private _commandValue = signal<string>(this.data.config?.command ?? "");
  readonly commandValue = this._commandValue.asReadonly();

  /** Commands filtered by what the user typed. */
  readonly filteredCommands = computed(() => {
    const query = this.commandValue()?.toLowerCase() ?? "";
    return this.allExistingCommands().filter(
      (ec) => ec.command.toLowerCase().includes(query) || ec.from.toLowerCase().includes(query),
    );
  });

  ngOnInit(): void {
    this.commandControl.valueChanges.subscribe((v) => this._commandValue.set(v as string));
    if (this.data.config?.flags?.length) {
      this.form.get("flagsText")!.setValue(this.data.config.flags.join("\n") + "\n");
    }
    if (this.data.config?.environment) {
      const envLines = Object.entries(this.data.config.environment)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      if (envLines) {
        this.form.get("envText")!.setValue(envLines + "\n");
      }
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

    const environment: Record<string, string> = {};
    for (const line of (this.form.get("envText")!.value as string).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      environment[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1);
    }

    const cfg: ServiceConfig = {
      name: (this.nameControl.value as string).trim(),
      type: "generic" as ServiceType,
      command: (this.commandControl.value as string).trim(),
      flags,
      environment,
    };

    this.dialogRef.close(cfg);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
