import { Component, Inject, inject, signal, computed, OnInit, OnDestroy } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatButtonModule } from "@angular/material/button";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { MatSelectModule } from "@angular/material/select";
import { ServiceConfig, ServiceType } from "../../../models/service";
import { ServiceService, AutocompleteSuggestion, AutocompleteType } from "../../../services/service.service";
import { Subscription } from "rxjs";
import { debounceTime, distinctUntilChanged, switchMap, catchError } from "rxjs/operators";
import { of } from "rxjs";

export interface LlamaServerDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select). */
  allConfigs?: ServiceConfig[];
}

/** Parsed llama-server options from form fields. */
interface LlamaOptions {
  // Basic
  host: string;
  port: number;
  threads: number;
  flashAttn: string;
  fit: string;
  apiKeyFile: string;
  parallel: number;
  // GPU
  device: string;
  tensorSplit: string;
  model: string;
  mmproj: string;
  nGpuLayers: number;
  // Draft model
  modelDraft: string;
  specDraftNMax: number;
  nGpuLayersDraft: number;
  // Speculative
  specType: string;
  // Context
  ctxSize: number;
  batchSize: number;
  ubatchSize: number;
}

const DEFAULT_OPTIONS: LlamaOptions = {
  host: "0.0.0.0",
  port: 4239,
  threads: 8,
  flashAttn: "on",
  fit: "off",
  apiKeyFile: "",
  parallel: 2,
  device: "",
  tensorSplit: "",
  model: "",
  mmproj: "",
  nGpuLayers: 999,
  modelDraft: "",
  specDraftNMax: 6,
  nGpuLayersDraft: 999,
  specType: "none",
  ctxSize: 524288,
  batchSize: 1024,
  ubatchSize: 512,
};

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

/** Extract value for a flag from the flags array. Handles both "--flag value" and "--flag=value". */
function findFlag(flags: string[], name: string): string | null {
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === name && i + 1 < flags.length) {
      return flags[i + 1];
    }
    const eqIdx = flags[i].indexOf("=");
    if (eqIdx > 0 && flags[i].slice(0, eqIdx) === name) {
      return flags[i].slice(eqIdx + 1);
    }
  }
  return null;
}

function flagValueStr(flags: string[], flag: string, fallback: string): string {
  const val = findFlag(flags, flag);
  return val !== null ? val : fallback;
}

function flagValueNum(flags: string[], flag: string, fallback: number): number {
  const val = findFlag(flags, flag);
  if (val !== null) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

@Component({
  selector: "app-llama-server-dialog",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatSelectModule,
  ],
  templateUrl: "./llama-server-dialog.component.html",
  styleUrls: ["./llama-server-dialog.component.scss"],
})
export class LlamaServerDialogComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<LlamaServerDialogComponent>);
  private data: LlamaServerDialogData = inject(MAT_DIALOG_DATA);
  private serviceService = inject(ServiceService);
  private subs = new Subscription();

  readonly isEdit = this.data.config !== null;

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

  // ── Autocomplete for path fields (model, mmproj, apiKeyFile) ──

  /** Available GPU device names from backend. */
  readonly availableDevices = signal<string[]>([]);

  /** Host suggestions (network IPs + defaults). */
  readonly hostSuggestions = signal<AutocompleteSuggestion[]>([]);

  /** Device suggestions (GPU engine names). */
  readonly deviceSuggestions = signal<AutocompleteSuggestion[]>([]);

  /** Path autocomplete suggestions keyed by field name. */
  private _pathSuggestions = signal<Record<string, AutocompleteSuggestion[]>>({
    model: [],
    mmproj: [],
    apiKeyFile: [],
  });
  readonly pathSuggestions = this._pathSuggestions.asReadonly();

  /** Current raw input value for path autocomplete fields. */
  private _pathInputValue = signal<Record<string, string>>({
    model: "",
    mmproj: "",
    apiKeyFile: "",
  });

  /** Host input value. */
  private _hostInputValue = signal<string>("");
  readonly filteredHosts = computed(() => {
    const query = this._hostInputValue().toLowerCase();
    return this.hostSuggestions().filter((s) => !query || s.path.toLowerCase().includes(query));
  });

  /** Setup debounced autocomplete subscription for a path field. */
  private setupPathAutocomplete(fieldName: string, type: AutocompleteType): void {
    this.subs.add(
      this.form
        .get(fieldName)!
        .valueChanges.pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value: string | null) => {
            const query = ((value as string) ?? "").trim();
            this._pathInputValue.update((prev) => ({ ...prev, [fieldName]: query }));
            if (!query) {
              return of<AutocompleteSuggestion[]>([]);
            }
            return this.serviceService
              .getLlamaAutocomplete(type, query)
              .pipe(catchError(() => of<AutocompleteSuggestion[]>([])));
          }),
        )
        .subscribe((suggestions) => {
          this._pathSuggestions.update((prev) => ({ ...prev, [fieldName]: suggestions }));
        }),
    );
  }

  /** Setup debounced autocomplete for host field. */
  private setupHostAutocomplete(): void {
    this.subs.add(
      this.form
        .get("host")!
        .valueChanges.pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value: string | null) => {
            this._hostInputValue.set((value as string) ?? "");
            const query = ((value as string) ?? "").trim();
            if (!query) {
              return of<AutocompleteSuggestion[]>([]);
            }
            return this.serviceService
              .getLlamaAutocomplete("host", query)
              .pipe(catchError(() => of<AutocompleteSuggestion[]>([])));
          }),
        )
        .subscribe((suggestions) => {
          this.hostSuggestions.set(suggestions);
        }),
    );
  }

  form = this.fb.group({
    name: [this.data.config?.name ?? "", { validators: [Validators.required, Validators.pattern(NAME_REGEX)] }],
    command: [this.data.config?.command ?? "", Validators.required],
    // Basic
    host: [DEFAULT_OPTIONS.host],
    port: [DEFAULT_OPTIONS.port],
    threads: [DEFAULT_OPTIONS.threads],
    flashAttn: [DEFAULT_OPTIONS.flashAttn],
    fit: [DEFAULT_OPTIONS.fit],
    apiKeyFile: [""],
    parallel: [DEFAULT_OPTIONS.parallel],
    // GPU
    device: [[] as string[]],
    tensorSplit: [""],
    model: [""],
    mmproj: [""],
    nGpuLayers: [DEFAULT_OPTIONS.nGpuLayers],
    // Draft model
    modelDraft: [""],
    specDraftNMax: [DEFAULT_OPTIONS.specDraftNMax],
    nGpuLayersDraft: [DEFAULT_OPTIONS.nGpuLayersDraft],
    // Speculative
    specType: [DEFAULT_OPTIONS.specType],
    // Context
    ctxSize: [DEFAULT_OPTIONS.ctxSize],
    batchSize: [DEFAULT_OPTIONS.batchSize],
    ubatchSize: [DEFAULT_OPTIONS.ubatchSize],
  });

  get nameControl() {
    return this.form.get("name")!;
  }
  get commandControl() {
    return this.form.get("command")!;
  }

  ngOnInit(): void {
    this.commandControl.valueChanges.subscribe((v) => this._commandValue.set(v as string));
    if (this.data.config) {
      this.populateFormFromFlags(this.data.config.flags);
    }

    // Load GPU devices for the device dropdown
    this.serviceService.getLlamaAutocomplete("device", "").subscribe({
      next: (suggestions) => {
        this.deviceSuggestions.set(suggestions);
        this.availableDevices.set(suggestions.map((s) => s.path));
      },
      error: () => {
        this.availableDevices.set([]);
      },
    });

    // Load host suggestions
    this.serviceService.getLlamaAutocomplete("host", "").subscribe({
      next: (suggestions) => {
        this.hostSuggestions.set(suggestions);
      },
      error: () => {
        this.hostSuggestions.set([]);
      },
    });

    // Setup debounced autocomplete for path fields
    this.setupPathAutocomplete("model", "model");
    this.setupPathAutocomplete("mmproj", "mmproj");
    this.setupPathAutocomplete("apiKeyFile", "apikey");

    // Setup host autocomplete
    this.setupHostAutocomplete();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private populateFormFromFlags(flags: string[]): void {
    this.form.get("host")!.setValue(flagValueStr(flags, "--host", DEFAULT_OPTIONS.host));
    this.form.get("port")!.setValue(flagValueNum(flags, "--port", DEFAULT_OPTIONS.port));
    this.form.get("threads")!.setValue(flagValueNum(flags, "--threads", DEFAULT_OPTIONS.threads));
    this.form.get("flashAttn")!.setValue(flagValueStr(flags, "--flash-attn", DEFAULT_OPTIONS.flashAttn));
    this.form.get("fit")!.setValue(flagValueStr(flags, "--fit", DEFAULT_OPTIONS.fit));
    this.form.get("apiKeyFile")!.setValue(flagValueStr(flags, "--api-key-file", ""));
    this.form.get("parallel")!.setValue(flagValueNum(flags, "--parallel", DEFAULT_OPTIONS.parallel));
    // Parse device string into array for mat-select multiple
    const deviceVal = findFlag(flags, "--device");
    this.form.get("device")!.setValue(
      deviceVal
        ? deviceVal
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean)
        : [],
    );
    this.form.get("tensorSplit")!.setValue(flagValueStr(flags, "--tensor-split", ""));
    this.form.get("model")!.setValue(flagValueStr(flags, "--model", ""));
    this.form.get("mmproj")!.setValue(flagValueStr(flags, "--mmproj", ""));
    this.form.get("nGpuLayers")!.setValue(flagValueNum(flags, "--n-gpu-layers", DEFAULT_OPTIONS.nGpuLayers));
    this.form.get("modelDraft")!.setValue(flagValueStr(flags, "--model-draft", ""));
    this.form.get("specDraftNMax")!.setValue(flagValueNum(flags, "--spec-draft-n-max", DEFAULT_OPTIONS.specDraftNMax));
    this.form
      .get("nGpuLayersDraft")!
      .setValue(flagValueNum(flags, "--n-gpu-layers-draft", DEFAULT_OPTIONS.nGpuLayersDraft));
    this.form.get("specType")!.setValue(flagValueStr(flags, "--spec-type", DEFAULT_OPTIONS.specType));
    this.form.get("ctxSize")!.setValue(flagValueNum(flags, "--ctx-size", DEFAULT_OPTIONS.ctxSize));
    this.form.get("batchSize")!.setValue(flagValueNum(flags, "--batch-size", DEFAULT_OPTIONS.batchSize));
    this.form.get("ubatchSize")!.setValue(flagValueNum(flags, "--ubatch-size", DEFAULT_OPTIONS.ubatchSize));
  }

  buildFlags(): string[] {
    const flags: string[] = [];
    const add = (flag: string, value: string | number | null | undefined) => {
      if (value !== null && value !== undefined && value !== "") {
        flags.push(`${flag} ${value}`);
      }
    };

    add("--host", this.form.get("host")!.value);
    add("--port", this.form.get("port")!.value);
    add("--threads", this.form.get("threads")!.value);
    add("--flash-attn", this.form.get("flashAttn")!.value);
    add("--fit", this.form.get("fit")!.value);
    add("--api-key-file", this.form.get("apiKeyFile")!.value);
    add("--parallel", this.form.get("parallel")!.value);
    // Join device array back to comma-separated string
    const deviceArr = this.form.get("device")!.value as string[];
    if (deviceArr && deviceArr.length > 0) {
      flags.push(`--device ${deviceArr.join(",")}`);
    }
    add("--tensor-split", this.form.get("tensorSplit")!.value);
    add("--model", this.form.get("model")!.value);
    add("--mmproj", this.form.get("mmproj")!.value);
    add("--n-gpu-layers", this.form.get("nGpuLayers")!.value);
    add("--model-draft", this.form.get("modelDraft")!.value);
    add("--spec-draft-n-max", this.form.get("specDraftNMax")!.value);
    add("--n-gpu-layers-draft", this.form.get("nGpuLayersDraft")!.value);
    add("--spec-type", this.form.get("specType")!.value);
    add("--ctx-size", this.form.get("ctxSize")!.value);
    add("--batch-size", this.form.get("batchSize")!.value);
    add("--ubatch-size", this.form.get("ubatchSize")!.value);

    return flags;
  }

  save(): void {
    if (this.form.invalid) return;

    const cfg: ServiceConfig = {
      name: (this.nameControl.value as string).trim(),
      type: "llama-server" as ServiceType,
      command: (this.commandControl.value as string).trim(),
      flags: this.buildFlags(),
    };

    this.dialogRef.close(cfg);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
