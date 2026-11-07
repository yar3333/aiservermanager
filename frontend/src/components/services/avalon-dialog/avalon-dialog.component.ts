import { Component, inject, signal, computed, OnInit, DestroyRef, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { MatTooltipModule } from "@angular/material/tooltip";
import { ServiceConfig, ServiceRestart, SERVICE_RESTART_VALUES, ServiceType } from "../../../models/service";
import { ServiceService, AutocompleteSuggestion } from "../../../services/service.service";
import { SystemService } from "../../../services/system.service";
import { GpuService } from "../../../services/gpu.service";
import { Gpu } from "../../../models/gpu";
import { buildRunAsLabels } from "../../../utils/run-as-fields";
import { syncDisabledControls } from "../../../utils/disabled-controls";
import { uniqueServiceName } from "../../../utils/service-name";
import { FileAutocompleteComponent } from "../../shared/file-autocomplete/file-autocomplete.component";
import { parseContextSize, formatContextSize, CONTEXT_PRESETS } from "../../../utils/context-size";
import { of, debounceTime, distinctUntilChanged, switchMap, catchError, startWith } from "rxjs";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";

export interface AvalonDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select and path reuse). */
  allConfigs?: ServiceConfig[];
  /** Clone mode: prefill from an existing config but create a new service (name stays editable). */
  clone?: boolean;
}

/**
 * The Avalon launcher (avalon/run.sh) takes no command-line arguments: every setting
 * is an environment variable it reads, and only EXTRA is forwarded to llama-server.
 * The fields below therefore write `env.*` keys, not flags.
 */
const DEFAULT_OPTIONS = {
  // Model
  model: "",
  // GPUs & vision
  gpus: "ROCm0",
  mmproj: "none",
  mmdev: "ROCm1",
  // Server & context
  host: "0.0.0.0",
  port: 4239,
  ctxSize: 262144,
  // Concurrency (the only EXTRA option)
  parallel: 1,
  // Extra launcher arguments + env (free-form)
  extraFlags: "",
  envText: "",
};

/**
 * Env keys owned by structured fields — never read from or written to the env textarea.
 * BIN and DRAFT are deliberately absent: they stay ordinary environment variables, so a
 * config that pins another build or MTP head keeps working through the textarea.
 */
const MANAGED_ENV_KEYS = ["MODEL", "GPUS", "MMPROJ", "MMDEV", "HOST", "PORT", "CTX", "EXTRA"];

/** Value of EXTRA that the Parallel field owns. */
function parallelFromExtra(extra: string | undefined): number {
  const match = (extra ?? "").match(/--parallel(?:[=\s]+)(\d+)/);
  return match ? parseInt(match[1], 10) : DEFAULT_OPTIONS.parallel;
}

/** Return true when the current form value differs from the launcher default. */
function isChanged(controlName: string, formValue: unknown): boolean {
  const defaultVal = (DEFAULT_OPTIONS as Record<string, unknown>)[controlName];
  if (defaultVal === undefined) return false;
  return String(formValue) !== String(defaultVal);
}

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

@Component({
  selector: "app-avalon-dialog",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    FileAutocompleteComponent,
  ],
  templateUrl: "./avalon-dialog.component.html",
  styleUrls: ["./avalon-dialog.component.scss"],
})
export class AvalonDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<AvalonDialogComponent>);
  private data: AvalonDialogData = inject(MAT_DIALOG_DATA);
  private serviceService = inject(ServiceService);
  private gpuService = inject(GpuService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  /** Wording and the group field follow the backend OS, not the browser. */
  private system = inject(SystemService);
  readonly runAs = buildRunAsLabels(this.system.windows);

  readonly isEdit = this.data.config !== null;
  readonly isClone = this.data.clone === true;

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

  private _commandValue = signal<string>(this.data.config?.command ?? "");
  readonly commandValue = this._commandValue.asReadonly();

  readonly filteredCommands = computed(() => {
    const query = this.commandValue()?.toLowerCase() ?? "";
    return this.allExistingCommands().filter(
      (ec) => ec.command.toLowerCase().includes(query) || ec.from.toLowerCase().includes(query),
    );
  });

  // ── Form ──

  form = this.fb.group({
    name: [
      this.data.config?.name ?? "",
      {
        validators: [
          Validators.required,
          Validators.pattern(NAME_REGEX),
          uniqueServiceName(this.data.allConfigs ?? [], this.data.config?.name ?? null),
        ],
      },
    ],
    command: [this.data.config?.command ?? "", Validators.required],
    // Model
    model: [DEFAULT_OPTIONS.model],
    // GPUs & vision
    gpus: [DEFAULT_OPTIONS.gpus],
    mmproj: [DEFAULT_OPTIONS.mmproj],
    mmdev: [DEFAULT_OPTIONS.mmdev],
    // Server & context
    host: [DEFAULT_OPTIONS.host],
    port: [DEFAULT_OPTIONS.port],
    // Shown formatted; the launcher wants raw tokens (CTX).
    ctxSize: [formatContextSize(DEFAULT_OPTIONS.ctxSize, 1)],
    // Concurrency
    parallel: [DEFAULT_OPTIONS.parallel],
    // Extra launcher arguments + env (free-form)
    extraFlags: [DEFAULT_OPTIONS.extraFlags],
    envText: [DEFAULT_OPTIONS.envText],
    // Service unit (systemd run-as + restart policy)
    user: [this.data.config?.user ?? ""],
    group: [this.data.config?.group ?? ""],
    restart: [this.data.config?.restart ?? "no"],
  });

  /** Options for the Restart= select. */
  readonly restartOptions = SERVICE_RESTART_VALUES;

  readonly availableGpus = toSignal(this.gpuService.fetchGpus().pipe(catchError(() => of<Gpu[]>([]))), {
    initialValue: [],
  });

  /**
   * Device names as llama-server names them (ROCm0, CUDA1, …) — the launcher passes GPUS
   * and MMDEV straight to `--device`/`-mmdev`. Taken from the GPU list rather than
   * `<binary> --list-devices`: the command is the launcher script, and running it with
   * any argument would start a full model load.
   */
  readonly deviceNames = computed<string[]>(() => {
    const names = this.availableGpus().map((g) => {
      const prefix = g.vendor === "NVIDIA" ? "CUDA" : g.vendor === "AMD" ? "ROCm" : "GPU";
      return `${prefix}${g.gpuIndex}`;
    });
    return [...new Set(names)];
  });

  /** MMDEV offload escape hatches the launcher recognises (lowercase — it compares literally). */
  readonly mmdevOffloadValues = ["none", "cpu"];

  /** Suggestions for MMDEV: GPU names plus the two ways to keep the ViT off the GPU. */
  readonly mmdevSuggestions = computed<string[]>(() => [...this.deviceNames(), ...this.mmdevOffloadValues]);

  /** Preset context-size options (raw token values — Avalon has no per-slot multiplier). */
  readonly ctxPresets = computed<{ label: string }[]>(() =>
    CONTEXT_PRESETS.map((p) => ({ label: formatContextSize(p, 1) })),
  );

  /** Host suggestions (network IPs + defaults). */
  readonly filteredHosts = toSignal(
    this.form.controls.host.valueChanges.pipe(
      takeUntilDestroyed(),
      startWith(this.form.controls.host.value as string),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((value: string | null) => {
        const query = (value ?? "").trim();
        if (!query) return of<AutocompleteSuggestion[]>([]);
        return this.serviceService
          .getLlamaAutocomplete("host", query)
          .pipe(catchError(() => of<AutocompleteSuggestion[]>([])));
      }),
    ),
    { initialValue: [] },
  );

  // ── Paths reused from other configs (autocomplete of an empty field) ──

  readonly existingModelPaths = computed<string[]>(() => this.existingEnvPaths("MODEL"));
  readonly existingMmprojPaths = computed<string[]>(() => this.existingEnvPaths("MMPROJ"));

  /** Values of one env key across the other configs. */
  private existingEnvPaths(key: string): string[] {
    const all = this.data.allConfigs ?? [];
    const currentName = this.data.config?.name ?? null;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const cfg of all) {
      if (cfg.name === currentName) continue;
      const val = cfg.environment?.[key];
      if (val && !seen.has(val)) {
        seen.add(val);
        result.push(val);
      }
    }
    return result;
  }

  /** Normalize free-form ctxSize input on blur / Enter (parse → re-format for consistent display). */
  onCtxSizeInput(): void {
    const parsed = parseContextSize((this.form.get("ctxSize")?.value as string) ?? "");
    this.form.get("ctxSize")?.setValue(formatContextSize(parsed, 1), { emitEvent: false });
  }

  /** Check whether a form control value differs from the launcher default. */
  isControlChanged(controlName: string): boolean {
    const val = this.form.get(controlName)?.value;
    // ctxSize is stored as a formatted string; compare the parsed number with the default.
    if (controlName === "ctxSize") {
      return +parseContextSize(val as string) !== DEFAULT_OPTIONS.ctxSize;
    }
    return val !== undefined && val !== null && isChanged(controlName, val);
  }

  /** Check whether any of the given controls differs from default (for panel-level highlighting). */
  isSectionChanged(...controlNames: string[]): boolean {
    return controlNames.some((name) => this.isControlChanged(name));
  }

  // ── Conditional signals ──

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  readonly mmprojValue = computed(() => (this.formValue()?.mmproj as string ?? "").trim());

  /** Vision is off while MMPROJ is "none", so MMDEV and the warning below are irrelevant. */
  readonly isVisionOn = computed(() => {
    const v = this.mmprojValue();
    return v !== "" && v.toLowerCase() !== "none";
  });

  /**
   * `--fit` claims the whole VRAM of the LLM card, so a ViT on that same card fails to
   * allocate (the launcher prints the same warning).
   */
  readonly isVisionDeviceClash = computed(() => {
    if (!this.isVisionOn()) return false;
    const mmdev = (this.formValue()?.mmdev as string ?? "").trim().toLowerCase();
    if (!mmdev || this.mmdevOffloadValues.includes(mmdev)) return false;
    const gpus = (this.formValue()?.gpus as string ?? "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    return gpus.includes(mmdev);
  });

  /**
   * Which fields are locked, put on the controls because Angular ignores a `disabled`
   * binding on an element carrying `formControlName`. The name stays editable: saving
   * under a new name renames the service, `uniqueServiceName` rejects a name in use.
   */
  private readonly lockedFields = syncDisabledControls(this.form, () => ({
    group: this.runAs.isGroupDisabled(),
  }));

  ngOnInit(): void {
    void this.system.detectWindows();
    this.form.controls.command.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((v) => this._commandValue.set(v!));

    if (this.data.config) {
      this.populateForm(this.data.config);
    }

    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  private populateForm(cfg: ServiceConfig): void {
    const f = this.form.controls;
    const env = cfg.environment ?? {};
    const str = (key: string, fallback: string): string => (env[key] !== undefined ? env[key] : fallback);

    // Model
    f.model.setValue(str("MODEL", DEFAULT_OPTIONS.model));

    // GPUs & vision
    f.gpus.setValue(str("GPUS", DEFAULT_OPTIONS.gpus));
    f.mmproj.setValue(str("MMPROJ", DEFAULT_OPTIONS.mmproj));
    f.mmdev.setValue(str("MMDEV", DEFAULT_OPTIONS.mmdev));

    // Server & context
    f.host.setValue(str("HOST", DEFAULT_OPTIONS.host));
    const port = parseInt(env["PORT"] ?? "", 10);
    f.port.setValue(isNaN(port) ? DEFAULT_OPTIONS.port : port);
    const ctx = parseInt(env["CTX"] ?? "", 10);
    f.ctxSize.setValue(formatContextSize(isNaN(ctx) ? DEFAULT_OPTIONS.ctxSize : ctx, 1));

    // Concurrency — the only thing this dialog reads out of EXTRA.
    f.parallel.setValue(parallelFromExtra(env["EXTRA"]));

    // Launcher arguments: run.sh ignores argv, they are kept only so a save cannot lose them.
    f.extraFlags.setValue((cfg.flags ?? []).join("\n"));

    // Environment: the keys above live in their own fields, the rest stays free-form.
    const envLines = Object.entries(env)
      .filter(([key]) => !MANAGED_ENV_KEYS.includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    if (envLines) f.envText.setValue(envLines + "\n");

    // Service unit (systemd run-as + restart policy)
    f.user.setValue(cfg.user ?? "");
    f.group.setValue(cfg.group ?? "");
    f.restart.setValue(cfg.restart ?? "no");
  }

  /** Free-form KEY=VALUE lines from the textarea; the fields own the managed keys. */
  parseEnvironment(text: string): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      if (MANAGED_ENV_KEYS.includes(key)) continue;
      environment[key] = trimmed.slice(eqIdx + 1);
    }
    return environment;
  }

  /**
   * Environment for the service: the managed keys first (launcher order), each only when it
   * differs from the launcher default, then whatever else the textarea holds.
   */
  buildEnvironment(): Record<string, string> {
    const c = this.form.controls;
    const env: Record<string, string> = {};
    const put = (key: string, value: string, defaultVal: string): void => {
      if (value && value !== defaultVal) env[key] = value;
    };

    put("MODEL", (c.model.value as string).trim(), DEFAULT_OPTIONS.model);
    put("GPUS", (c.gpus.value as string).trim(), DEFAULT_OPTIONS.gpus);
    put("MMPROJ", (c.mmproj.value as string).trim(), DEFAULT_OPTIONS.mmproj);
    put("MMDEV", (c.mmdev.value as string).trim(), DEFAULT_OPTIONS.mmdev);
    put("HOST", (c.host.value as string).trim(), DEFAULT_OPTIONS.host);

    if (String(c.port.value) !== String(DEFAULT_OPTIONS.port)) env["PORT"] = String(c.port.value);

    // A cleared field parses to 0: leave CTX unset so the launcher default stands.
    const ctx = +parseContextSize(c.ctxSize.value as string);
    if (ctx > 0 && ctx !== DEFAULT_OPTIONS.ctxSize) env["CTX"] = String(ctx);

    const parallel = c.parallel.value ?? DEFAULT_OPTIONS.parallel;
    if (parallel !== DEFAULT_OPTIONS.parallel && parallel > 0) env["EXTRA"] = `--parallel ${parallel}`;

    return Object.assign(env, this.parseEnvironment(c.envText.value as string));
  }

  save(): void {
    if (this.form.invalid) return;

    const environment = this.buildEnvironment();
    const cfg: ServiceConfig = {
      name: this.form.controls.name.value!.trim(),
      type: "avalon" as ServiceType,
      command: this.form.controls.command.value!.trim(),
      flags: this.parseExtraFlags(),
      ...(Object.keys(environment).length ? { environment } : {}),
    };

    // Service unit run-as + restart policy (systemd User=/Group=/Restart=)
    const user = ((this.form.controls.user.value as string) ?? "").trim();
    const group = ((this.form.controls.group.value as string) ?? "").trim();
    const restart = this.form.controls.restart.value as ServiceRestart;
    if (user) cfg.user = user;
    if (group) cfg.group = group;
    if (restart && restart !== "no") cfg.restart = restart;

    // Conf keys without a field in this dialog must survive a save.
    if (this.data.config?.workingDirectory) cfg.workingDirectory = this.data.config.workingDirectory;
    if (this.data.config?.stopCommand) cfg.stopCommand = this.data.config.stopCommand;

    this.dialogRef.close(cfg);
  }

  /** Launcher arguments, kept verbatim one per line. */
  private parseExtraFlags(): string[] {
    return (this.form.controls.extraFlags.value as string)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
