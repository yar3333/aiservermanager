import { Component, inject, signal, computed, OnInit, DestroyRef, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatButtonModule } from "@angular/material/button";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatSelectModule } from "@angular/material/select";
import { MatTooltipModule } from "@angular/material/tooltip";
import { ServiceConfig, ServiceRestart, SERVICE_RESTART_VALUES, ServiceType } from "../../../models/service";
import { SystemService } from "../../../services/system.service";
import { GpuService } from "../../../services/gpu.service";
import { Gpu } from "../../../models/gpu";
import { buildRunAsLabels } from "../../../utils/run-as-fields";
import { syncDisabledControls } from "../../../utils/disabled-controls";
import { uniqueServiceName } from "../../../utils/service-name";
import { findFlag } from "../llama-server-dialog/flag-parsing";
import { FileAutocompleteComponent } from "../../shared/file-autocomplete/file-autocomplete.component";
import { parseContextSize, formatContextSize, CONTEXT_PRESETS } from "../../../utils/context-size";
import { of, catchError } from "rxjs";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";

export interface StrataRdna3DialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select and path reuse). */
  allConfigs?: ServiceConfig[];
  /** Clone mode: prefill from an existing config but create a new service (name stays editable). */
  clone?: boolean;
}

/**
 * Every default below is the value strata-rdna3/run.sh itself documents in `--help`, so a
 * field left at its default emits nothing and the launcher keeps deciding it. The three
 * exceptions are the options whose run.sh default means "don't touch the fork's config
 * pair" (conv-slots, kv-resident, vram-reserve-mib): an empty field emits nothing, a typed
 * value — including 0 — replaces that pair.
 */
const DEFAULT_OPTIONS = {
  // Model & pack
  model: "",
  pack: "",
  mmproj: "",
  dataDir: "",
  rocm: "",
  keysIni: "",
  // Card layout
  gpus: "0,1",
  tp: "2",
  layerSplit: "auto",
  pipelineWindows: 2,
  // Context & cache
  ctxSize: 262144,
  convCacheMib: 0,
  convSlots: "",
  kvResident: "",
  vramReserveMib: "",
  pleIo: "ram",
  // Modes
  mtp: "on",
  vision: "off",
  visionDev: 3,
  megakernel: "off",
  toolcall: "off",
  reasoningEffort: "medium",
  reasoningBudget: "",
  // Server
  port: 4239,
  // Free-form
  extraFlags: "",
  envText: "",
};

/**
 * MiB --vram-reserve-mib must leave on a card the vision encoder shares with the model.
 * Below it the engine fills the card to zero and the encoder is SIGKILLed — measured on the
 * 4-GPU Q8 configs, which is why they all carry `--vram-reserve-mib 2048`.
 */
const MIN_VRAM_RESERVE_FOR_SHARED_CARD = 2048;

/** --tensor-parallel only accepts these; the launcher spells "no tensor split" as `none`. */
const TP_OPTIONS = ["2", "1", "none"];

const PLE_IO_OPTIONS = ["ram", "direct"];
const REASONING_EFFORTS = ["none", "low", "medium", "high"];

/** Flags the structured fields own; anything else stays verbatim in the extra-flags field. */
const KNOWN_STRATA_FLAGS = new Set([
  "--model",
  "--pack",
  "--mmproj",
  "--data-dir",
  "--rocm",
  "--keys-ini",
  "--gpus",
  "--tp",
  "--layer-split",
  "--pipeline-windows",
  "--ctx",
  "--conv-cache-mib",
  "--conv-slots",
  "--kv-resident",
  "--vram-reserve-mib",
  "--ple-io",
  "--mtp",
  "--vision",
  "--vision-dev",
  "--megakernel",
  "--toolcall",
  "--reasoning-effort",
  "--reasoning-budget",
  "--port",
]);

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

/** null/undefined and "" are the same setting here: "leave it to run.sh". */
function normalize(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/**
 * Comma-separated list without whitespace ("0, 1, 2" → "0,1,2"). run.sh splits argv, so a
 * space in the list would reach the parser as a second argument and abort the launch.
 */
function collapseList(value: unknown): string {
  return normalize(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",");
}

/** Return true when the current form value differs from the launcher default. */
function isChanged(controlName: string, formValue: unknown): boolean {
  const defaultVal = (DEFAULT_OPTIONS as Record<string, unknown>)[controlName];
  if (defaultVal === undefined) return false;
  return normalize(formValue) !== normalize(defaultVal);
}

function flagStr(flags: string[], name: string, fallback: string): string {
  const val = findFlag(flags, name);
  return val !== null && val !== "" ? val : fallback;
}

function flagNum(flags: string[], name: string, fallback: number): number {
  const val = findFlag(flags, name);
  if (val !== null) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/** Raw string of a numeric flag, so a stored `0` is not confused with an unset field. */
function flagRaw(flags: string[], name: string): string {
  return findFlag(flags, name) ?? "";
}

@Component({
  selector: "app-strata-rdna3-dialog",
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
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    FileAutocompleteComponent,
  ],
  templateUrl: "./strata-rdna3-dialog.component.html",
  styleUrls: ["./strata-rdna3-dialog.component.scss"],
})
export class StrataRdna3DialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<StrataRdna3DialogComponent>);
  private data: StrataRdna3DialogData = inject(MAT_DIALOG_DATA);
  private gpuService = inject(GpuService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  /** Wording and the group field follow the backend OS, not the browser. */
  private system = inject(SystemService);
  readonly runAs = buildRunAsLabels(this.system.windows);

  readonly isEdit = this.data.config !== null;
  readonly isClone = this.data.clone === true;

  readonly tpOptions = TP_OPTIONS;
  readonly pleIoOptions = PLE_IO_OPTIONS;
  readonly reasoningEfforts = REASONING_EFFORTS;
  readonly minVramReserveForSharedCard = MIN_VRAM_RESERVE_FOR_SHARED_CARD;

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
    // Model & pack
    model: [DEFAULT_OPTIONS.model],
    pack: [DEFAULT_OPTIONS.pack],
    mmproj: [DEFAULT_OPTIONS.mmproj],
    dataDir: [DEFAULT_OPTIONS.dataDir],
    rocm: [DEFAULT_OPTIONS.rocm],
    keysIni: [DEFAULT_OPTIONS.keysIni],
    // Card layout
    gpus: [DEFAULT_OPTIONS.gpus],
    tp: [DEFAULT_OPTIONS.tp],
    layerSplit: [DEFAULT_OPTIONS.layerSplit],
    pipelineWindows: [DEFAULT_OPTIONS.pipelineWindows],
    // Context & cache
    ctxSize: [formatContextSize(DEFAULT_OPTIONS.ctxSize, 1)],
    convCacheMib: [DEFAULT_OPTIONS.convCacheMib],
    convSlots: [DEFAULT_OPTIONS.convSlots],
    kvResident: [DEFAULT_OPTIONS.kvResident],
    vramReserveMib: [DEFAULT_OPTIONS.vramReserveMib],
    pleIo: [DEFAULT_OPTIONS.pleIo],
    // Modes
    mtp: [DEFAULT_OPTIONS.mtp],
    vision: [DEFAULT_OPTIONS.vision],
    visionDev: [DEFAULT_OPTIONS.visionDev],
    megakernel: [DEFAULT_OPTIONS.megakernel],
    toolcall: [DEFAULT_OPTIONS.toolcall],
    reasoningEffort: [DEFAULT_OPTIONS.reasoningEffort],
    reasoningBudget: [DEFAULT_OPTIONS.reasoningBudget],
    // Server
    port: [DEFAULT_OPTIONS.port],
    // Free-form
    extraFlags: [DEFAULT_OPTIONS.extraFlags],
    envText: [DEFAULT_OPTIONS.envText],
    // Service unit (systemd run-as + restart policy)
    user: [this.data.config?.user ?? ""],
    group: [this.data.config?.group ?? ""],
    restart: [this.data.config?.restart ?? "no"],
  });

  /** Options for the Restart= select. */
  readonly restartOptions = SERVICE_RESTART_VALUES;

  // ── GPU cards of this host (the launcher numbers them the way HIP does) ──

  readonly availableGpus = toSignal(this.gpuService.fetchGpus().pipe(catchError(() => of<Gpu[]>([]))), {
    initialValue: [],
  });

  /** Runtime device numbers — what --gpus and --vision-dev expect. */
  readonly gpuIndices = computed<number[]>(() => [
    ...new Set(this.availableGpus().map((g) => g.gpuIndex)),
  ]);

  /** "0 — RX 7900 XTX, 1 — …" for the tooltip of the card fields. */
  readonly gpuSummary = computed<string>(() =>
    this.availableGpus()
      .map((g) => `${g.gpuIndex} — ${g.name}`)
      .join(", "),
  );

  /** Names the numbers the field expects, so nobody types a ROCmN label by habit. */
  readonly gpuTooltip = computed<string>(() =>
    this.gpuSummary()
      ? `Cards the model is split across (--gpus): runtime device numbers separated by commas. This host: ${this.gpuSummary()}`
      : "Cards the model is split across (--gpus): runtime device numbers separated by commas. Default: 0,1",
  );

  /** Preset context sizes (raw token counts; strata has no per-slot multiplier). */
  readonly ctxPresets = computed<{ label: string }[]>(() =>
    CONTEXT_PRESETS.map((p) => ({ label: formatContextSize(p, 1) })),
  );

  // ── Paths reused from other configs ──

  readonly existingModelPaths = computed<string[]>(() => this.existingFlagValues("--model"));
  readonly existingPackPaths = computed<string[]>(() => this.existingFlagValues("--pack"));
  readonly existingMmprojPaths = computed<string[]>(() => this.existingFlagValues("--mmproj"));

  /** Values one flag already has in the other configs. */
  private existingFlagValues(flagName: string): string[] {
    const all = this.data.allConfigs ?? [];
    const currentName = this.data.config?.name ?? null;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const cfg of all) {
      if (cfg.name === currentName) continue;
      const val = findFlag(cfg.flags ?? [], flagName);
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
    return isChanged(controlName, val);
  }

  /** Check whether any of the given controls differs from default (for panel-level highlighting). */
  isSectionChanged(...controlNames: string[]): boolean {
    return controlNames.some((name) => this.isControlChanged(name));
  }

  // ── Conditional signals ──

  /**
   * Snapshot of the whole form. `computed()` only re-evaluates on a signal read, so the
   * value signals below derive from this rather than `form.get(...).value` to update live.
   */
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  readonly visionValue = computed(() => (this.formValue()?.vision as string) ?? DEFAULT_OPTIONS.vision);
  readonly toolcallValue = computed(() => (this.formValue()?.toolcall as string) ?? DEFAULT_OPTIONS.toolcall);
  readonly pleIoValue = computed(() => (this.formValue()?.pleIo as string) ?? DEFAULT_OPTIONS.pleIo);

  readonly isVisionOn = computed(() => this.visionValue() === "on");
  readonly isToolcallOn = computed(() => this.toolcallValue() === "on");

  /** run.sh applies reasoning_effort / reasoning_budget only inside the toolcall branch. */
  readonly isReasoningDisabled = computed(() => !this.isToolcallOn());

  /** --vision-dev is read only when the encoder is enabled. */
  readonly isVisionDevDisabled = computed(() => !this.isVisionOn());

  /** Numbers of the cards listed in --gpus. */
  readonly gpusList = computed<number[]>(() =>
    (this.formValue()?.gpus as string ?? "")
      .split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !isNaN(n)),
  );

  /**
   * The engine takes 1|2 for --tensor-parallel (generate.cpp), so more than two cards can
   * only be laid out with `--tp none` plus --layer-split.
   */
  readonly isTensorParallelTooNarrow = computed(
    () => this.gpusList().length > 2 && (this.formValue()?.tp as string) !== "none",
  );

  /**
   * The encoder shares a card with the model: without a reserve the engine fills that card
   * to zero and the encoder dies of SIGKILL, so --vram-reserve-mib has to cover it.
   */
  readonly isVisionCardClash = computed(() => {
    if (!this.isVisionOn()) return false;
    const dev = parseInt(normalize(this.formValue()?.visionDev), 10);
    if (isNaN(dev) || !this.gpusList().includes(dev)) return false;
    const reserve = parseInt(normalize(this.formValue()?.vramReserveMib), 10);
    return isNaN(reserve) || reserve < MIN_VRAM_RESERVE_FOR_SHARED_CARD;
  });

  /** --ple-io direct reads the PLE table from SSD per token — 4-5x slower (22 vs 95 tok/s). */
  readonly isPleIoSlow = computed(() => this.pleIoValue() === "direct");

  /**
   * Which fields are locked, put on the controls because Angular ignores a `disabled`
   * binding on an element carrying `formControlName`. The name stays editable: saving
   * under a new name renames the service, `uniqueServiceName` rejects a name in use.
   */
  private readonly lockedFields = syncDisabledControls(this.form, () => ({
    group: this.runAs.isGroupDisabled(),
    visionDev: this.isVisionDevDisabled(),
    reasoningEffort: this.isReasoningDisabled(),
    reasoningBudget: this.isReasoningDisabled(),
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
    const flags = cfg.flags ?? [];

    // Model & pack
    f.model.setValue(flagStr(flags, "--model", DEFAULT_OPTIONS.model));
    f.pack.setValue(flagStr(flags, "--pack", DEFAULT_OPTIONS.pack));
    f.mmproj.setValue(flagStr(flags, "--mmproj", DEFAULT_OPTIONS.mmproj));
    f.dataDir.setValue(flagStr(flags, "--data-dir", DEFAULT_OPTIONS.dataDir));
    f.rocm.setValue(flagStr(flags, "--rocm", DEFAULT_OPTIONS.rocm));
    f.keysIni.setValue(flagStr(flags, "--keys-ini", DEFAULT_OPTIONS.keysIni));

    // Card layout
    f.gpus.setValue(flagStr(flags, "--gpus", DEFAULT_OPTIONS.gpus));
    f.tp.setValue(flagStr(flags, "--tp", DEFAULT_OPTIONS.tp));
    f.layerSplit.setValue(flagStr(flags, "--layer-split", DEFAULT_OPTIONS.layerSplit));
    f.pipelineWindows.setValue(flagNum(flags, "--pipeline-windows", DEFAULT_OPTIONS.pipelineWindows));

    // Context & cache
    f.ctxSize.setValue(formatContextSize(flagNum(flags, "--ctx", DEFAULT_OPTIONS.ctxSize), 1));
    f.convCacheMib.setValue(flagNum(flags, "--conv-cache-mib", DEFAULT_OPTIONS.convCacheMib));
    f.convSlots.setValue(flagRaw(flags, "--conv-slots"));
    f.kvResident.setValue(flagRaw(flags, "--kv-resident"));
    f.vramReserveMib.setValue(flagRaw(flags, "--vram-reserve-mib"));
    f.pleIo.setValue(flagStr(flags, "--ple-io", DEFAULT_OPTIONS.pleIo));

    // Modes
    f.mtp.setValue(flagStr(flags, "--mtp", DEFAULT_OPTIONS.mtp));
    f.vision.setValue(flagStr(flags, "--vision", DEFAULT_OPTIONS.vision));
    f.visionDev.setValue(flagNum(flags, "--vision-dev", DEFAULT_OPTIONS.visionDev));
    f.megakernel.setValue(flagStr(flags, "--megakernel", DEFAULT_OPTIONS.megakernel));
    f.toolcall.setValue(flagStr(flags, "--toolcall", DEFAULT_OPTIONS.toolcall));
    f.reasoningEffort.setValue(flagStr(flags, "--reasoning-effort", DEFAULT_OPTIONS.reasoningEffort));
    f.reasoningBudget.setValue(flagRaw(flags, "--reasoning-budget"));

    // Server
    f.port.setValue(flagNum(flags, "--port", DEFAULT_OPTIONS.port));

    // Flags no field covers stay verbatim.
    f.extraFlags.setValue(this.extractExtraFlags(flags).join("\n"));

    if (cfg.environment) {
      const envLines = Object.entries(cfg.environment)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      if (envLines) f.envText.setValue(envLines + "\n");
    }

    // Service unit (systemd run-as + restart policy)
    f.user.setValue(cfg.user ?? "");
    f.group.setValue(cfg.group ?? "");
    f.restart.setValue(cfg.restart ?? "no");
  }

  /** Flag lines not covered by structured fields (kept verbatim, one per line). */
  private extractExtraFlags(flags: string[]): string[] {
    const result: string[] = [];
    for (const entry of flags) {
      const key = entry.split(/\s|=/)[0];
      if (entry.startsWith("--") && !KNOWN_STRATA_FLAGS.has(key)) {
        result.push(entry);
      }
    }
    return result;
  }

  /** Free-form KEY=VALUE lines from the textarea. */
  parseEnvironment(text: string): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      environment[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1);
    }
    return environment;
  }

  /** Add `--flag value` only when the field differs from the launcher default. */
  private addIf(flags: string[], flag: string, value: unknown, defaultVal: string | number): void {
    const raw = normalize(value).trim();
    if (raw && raw !== normalize(defaultVal)) flags.push(`${flag} ${raw}`);
  }

  /**
   * Add a flag whose run.sh default is "absent" (the fork's config pair stands). Here 0 is a
   * real value, so only an empty field emits nothing.
   */
  private addWhenSet(flags: string[], flag: string, value: unknown): void {
    const raw = normalize(value).trim();
    if (raw) flags.push(`${flag} ${raw}`);
  }

  /**
   * Argument order mirrors the existing strata configs (model/pack/mmproj → mtp → card
   * layout → cache → vision → toolcall), so re-saving one of them shuffles nothing.
   */
  buildFlags(): string[] {
    const flags: string[] = [];
    const c = this.form.controls;

    // Model & pack
    this.addIf(flags, "--model", c.model.value, DEFAULT_OPTIONS.model);
    this.addIf(flags, "--pack", c.pack.value, DEFAULT_OPTIONS.pack);
    this.addIf(flags, "--mmproj", c.mmproj.value, DEFAULT_OPTIONS.mmproj);
    this.addIf(flags, "--data-dir", c.dataDir.value, DEFAULT_OPTIONS.dataDir);
    this.addIf(flags, "--rocm", c.rocm.value, DEFAULT_OPTIONS.rocm);
    this.addIf(flags, "--keys-ini", c.keysIni.value, DEFAULT_OPTIONS.keysIni);

    // Modes that move the model layout first, as the existing configs do
    this.addIf(flags, "--mtp", c.mtp.value, DEFAULT_OPTIONS.mtp);

    // Card layout
    this.addIf(flags, "--gpus", collapseList(c.gpus.value), DEFAULT_OPTIONS.gpus);
    this.addIf(flags, "--tp", c.tp.value, DEFAULT_OPTIONS.tp);
    this.addIf(flags, "--layer-split", collapseList(c.layerSplit.value), DEFAULT_OPTIONS.layerSplit);
    this.addIf(flags, "--pipeline-windows", c.pipelineWindows.value, DEFAULT_OPTIONS.pipelineWindows);

    // Context & cache
    this.addIf(flags, "--ctx", +parseContextSize(c.ctxSize.value ?? ""), DEFAULT_OPTIONS.ctxSize);
    this.addIf(flags, "--conv-cache-mib", c.convCacheMib.value, DEFAULT_OPTIONS.convCacheMib);
    this.addWhenSet(flags, "--conv-slots", c.convSlots.value);
    this.addWhenSet(flags, "--kv-resident", c.kvResident.value);
    this.addIf(flags, "--ple-io", c.pleIo.value, DEFAULT_OPTIONS.pleIo);

    // Vision. The reserve is emitted here, not with the other cache knobs, because that is
    // where the existing configs carry it — it exists for the encoder sharing a card.
    this.addIf(flags, "--vision", c.vision.value, DEFAULT_OPTIONS.vision);
    if (this.isVisionOn()) {
      this.addIf(flags, "--vision-dev", c.visionDev.value, DEFAULT_OPTIONS.visionDev);
    }
    this.addWhenSet(flags, "--vram-reserve-mib", c.vramReserveMib.value);

    // Agent mode and its reasoning defaults, which run.sh reads only in that branch
    this.addIf(flags, "--megakernel", c.megakernel.value, DEFAULT_OPTIONS.megakernel);
    this.addIf(flags, "--toolcall", c.toolcall.value, DEFAULT_OPTIONS.toolcall);
    if (this.isToolcallOn()) {
      this.addIf(flags, "--reasoning-effort", c.reasoningEffort.value, DEFAULT_OPTIONS.reasoningEffort);
      this.addWhenSet(flags, "--reasoning-budget", c.reasoningBudget.value);
    }

    // Server
    this.addIf(flags, "--port", c.port.value, DEFAULT_OPTIONS.port);

    // Free-form arguments, verbatim
    for (const line of (c.extraFlags.value as string).split("\n")) {
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith("--")) flags.push(trimmed);
    }

    return flags;
  }

  save(): void {
    if (this.form.invalid) return;

    const environment = this.parseEnvironment(this.form.controls.envText.value as string);
    const cfg: ServiceConfig = {
      name: this.form.controls.name.value!.trim(),
      type: "strata-rdna3" as ServiceType,
      command: this.form.controls.command.value!.trim(),
      flags: this.buildFlags(),
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

  cancel(): void {
    this.dialogRef.close();
  }
}
