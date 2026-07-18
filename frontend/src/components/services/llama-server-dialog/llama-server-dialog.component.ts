import { Component, inject, signal, computed, OnInit, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { MatAutocompleteModule } from "@angular/material/autocomplete";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { MatSelectModule } from "@angular/material/select";
import { MatTooltipModule } from "@angular/material/tooltip";
import { ServiceConfig, ServiceType } from "../../../models/service";
import { ServiceService, AutocompleteSuggestion } from "../../../services/service.service";
import { FileAutocompleteComponent } from "../../shared/file-autocomplete/file-autocomplete.component";
import { of, debounceTime, distinctUntilChanged, switchMap, catchError } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";

export interface LlamaServerDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select). */
  allConfigs?: ServiceConfig[];
}

const DEFAULT_OPTIONS = {
  // Basic
  host: "127.0.0.1",
  port: 8080,
  threads: -1,
  flashAttn: "auto",
  fit: "on",
  parallel: -1,
  alias: "",
  nPredict: -1,
  contextShift: "off",
  contBatching: "on",
  // GPU & Model
  model: "",
  mmproj: "",
  nGpuLayers: "auto",
  device: [] as string[],
  tensorSplit: "",
  splitMode: "layer",
  mainGpu: 0,
  fitTarget: 1024,
  fitCtx: 4096,
  mlock: "off",
  mmap: "on",
  cpuMoe: "off",
  nCpuMoe: 0,
  // Context & KV Cache
  ctxSize: 0,
  batchSize: 2048,
  ubatchSize: 512,
  cacheTypeK: "f16",
  cacheTypeV: "f16",
  kvOffload: "on",
  cacheRam: 8192,
  swaFull: "off",
  // RoPE
  ropeScaling: "none",
  ropeScale: 1.0,
  ropeFreqBase: 0,
  ropeFreqScale: 0,
  yarnOrigCtx: 0,
  yarnExtFactor: -1,
  yarnAttnFactor: -1,
  yarnBetaSlow: -1,
  yarnBetaFast: -1,
  // Sampling
  temperature: 0.8,
  seed: -1,
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  typicalP: 1.0,
  repeatLastN: 64,
  repeatPenalty: 1.0,
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  dryMultiplier: 0.0,
  dryBase: 1.75,
  mirostat: 0,
  dynatempRange: 0.0,
  // Speculative
  modelDraft: "",
  specDraftNMax: 3,
  nGpuLayersDraft: "auto",
  specDraftCacheTypeK: "f16",
  specDraftCacheTypeV: "f16",
  specType: "none",
  specNgramModNMin: 48,
  specNgramModNMax: 64,
  specNgramModNMatch: 24,
  specNgramSimpleSizeN: 12,
  specNgramSimpleSizeM: 48,
  specNgramSimpleMinHits: 1,
  // LoRA
  lora: "",
  loraScaled: "",
  // Server
  timeout: 3600,
  threadsHttp: -1,
  metrics: "off",
  slots: "on",
  cachePrompt: "on",
  cacheReuse: 0,
  // Reasoning
  reasoning: "auto",
  reasoningBudget: -1,
  reasoningFormat: "auto",
  // Auth
  apiKeyFile: "",
};

/** Return true when the current form value differs from its compiled default. */
function isChanged(controlName: string, formValue: unknown): boolean {
  const defaultVal = (DEFAULT_OPTIONS as Record<string, unknown>)[controlName];
  if (defaultVal === undefined) return false;
  // Arrays: [].toString() === "", non-empty → non-empty string
  if (Array.isArray(formValue) || Array.isArray(defaultVal)) {
    const f = Array.isArray(formValue) ? formValue : [];
    const d = Array.isArray(defaultVal) ? defaultVal : [];
    return f.length !== d.length || f.some((v, i) => v !== d[i]);
  }
  return String(formValue) !== String(defaultVal);
}

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

const KV_CACHE_TYPES = ["f32", "f16", "bf16", "q8_0", "q4_0", "q4_1", "iq4_nl", "q5_0", "q5_1"];

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

function flagValueFloat(flags: string[], flag: string, fallback: number): number {
  const val = findFlag(flags, flag);
  if (val !== null) {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/** Check if a boolean flag is present. For negation pairs, checks both variants. */
function flagBool(flags: string[], positive: string, negative: string, fallback: boolean): boolean {
  if (flags.includes(positive)) return true;
  if (flags.includes(negative)) return false;
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
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatDialogModule,
    MatSelectModule,
    MatTooltipModule,
    FileAutocompleteComponent,
  ],
  templateUrl: "./llama-server-dialog.component.html",
  styleUrls: ["./llama-server-dialog.component.scss"],
})
export class LlamaServerDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<LlamaServerDialogComponent>);
  private data: LlamaServerDialogData = inject(MAT_DIALOG_DATA);
  private serviceService = inject(ServiceService);
  private cdr = inject(ChangeDetectorRef);

  readonly isEdit = this.data.config !== null;

  readonly kvCacheTypes = KV_CACHE_TYPES;

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

  // ── Device + Host autocomplete ──

  /** Available GPU device names from backend. */
  readonly availableDevices = signal<string[]>([]);

  /** Host suggestions (network IPs + defaults). */
  readonly filteredHosts = signal<AutocompleteSuggestion[]>([]);

  // ── Existing paths from other configs (for empty-input autocomplete) ──

  readonly existingModelPaths = computed<string[]>(() => this.extractConfigPaths("--model"));
  readonly existingMmprojPaths = computed<string[]>(() => this.extractConfigPaths("--mmproj"));
  readonly existingApiKeyPaths = computed<string[]>(() => this.extractConfigPaths("--api-key-file"));
  readonly existingDraftModelPaths = computed<string[]>(() => this.extractConfigPaths("--model-draft"));
  readonly existingLoraPaths = computed<string[]>(() => this.extractConfigPaths("--lora"));

  /** Extract unique values for a given --flag from all configs (excluding current in edit mode). */
  private extractConfigPaths(flagName: string): string[] {
    const all = this.data.allConfigs ?? [];
    const currentName = this.data.config?.name ?? null;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const cfg of all) {
      if (cfg.name === currentName) continue;
      if (!cfg.flags) continue;
      const val = findFlag(cfg.flags, flagName);
      if (val && !seen.has(val)) {
        seen.add(val);
        result.push(val);
      }
    }
    return result;
  }

  // ── Form ──

  form = this.fb.group({
    name: [this.data.config?.name ?? "", { validators: [Validators.required, Validators.pattern(NAME_REGEX)] }],
    command: [this.data.config?.command ?? "", Validators.required],
    // Basic
    host: [DEFAULT_OPTIONS.host],
    port: [DEFAULT_OPTIONS.port],
    threads: [DEFAULT_OPTIONS.threads],
    flashAttn: [DEFAULT_OPTIONS.flashAttn],
    fit: [DEFAULT_OPTIONS.fit],
    parallel: [DEFAULT_OPTIONS.parallel],
    alias: [DEFAULT_OPTIONS.alias],
    nPredict: [DEFAULT_OPTIONS.nPredict],
    contextShift: [DEFAULT_OPTIONS.contextShift],
    contBatching: [DEFAULT_OPTIONS.contBatching],
    // GPU & Model
    model: [""],
    mmproj: [""],
    nGpuLayers: [DEFAULT_OPTIONS.nGpuLayers],
    device: [[] as string[]],
    tensorSplit: [""],
    splitMode: [DEFAULT_OPTIONS.splitMode],
    mainGpu: [DEFAULT_OPTIONS.mainGpu],
    fitTarget: [DEFAULT_OPTIONS.fitTarget],
    fitCtx: [DEFAULT_OPTIONS.fitCtx],
    mlock: [DEFAULT_OPTIONS.mlock],
    mmap: [DEFAULT_OPTIONS.mmap],
    cpuMoe: [DEFAULT_OPTIONS.cpuMoe],
    nCpuMoe: [DEFAULT_OPTIONS.nCpuMoe],
    // Context & KV Cache
    ctxSize: [DEFAULT_OPTIONS.ctxSize],
    batchSize: [DEFAULT_OPTIONS.batchSize],
    ubatchSize: [DEFAULT_OPTIONS.ubatchSize],
    cacheTypeK: [DEFAULT_OPTIONS.cacheTypeK],
    cacheTypeV: [DEFAULT_OPTIONS.cacheTypeV],
    kvOffload: [DEFAULT_OPTIONS.kvOffload],
    cacheRam: [DEFAULT_OPTIONS.cacheRam],
    swaFull: [DEFAULT_OPTIONS.swaFull],
    // RoPE
    ropeScaling: [DEFAULT_OPTIONS.ropeScaling],
    ropeScale: [DEFAULT_OPTIONS.ropeScale],
    ropeFreqBase: [DEFAULT_OPTIONS.ropeFreqBase],
    ropeFreqScale: [DEFAULT_OPTIONS.ropeFreqScale],
    yarnOrigCtx: [DEFAULT_OPTIONS.yarnOrigCtx],
    yarnExtFactor: [DEFAULT_OPTIONS.yarnExtFactor],
    yarnAttnFactor: [DEFAULT_OPTIONS.yarnAttnFactor],
    yarnBetaSlow: [DEFAULT_OPTIONS.yarnBetaSlow],
    yarnBetaFast: [DEFAULT_OPTIONS.yarnBetaFast],
    // Sampling
    temperature: [DEFAULT_OPTIONS.temperature],
    seed: [DEFAULT_OPTIONS.seed],
    topK: [DEFAULT_OPTIONS.topK],
    topP: [DEFAULT_OPTIONS.topP],
    minP: [DEFAULT_OPTIONS.minP],
    typicalP: [DEFAULT_OPTIONS.typicalP],
    repeatLastN: [DEFAULT_OPTIONS.repeatLastN],
    repeatPenalty: [DEFAULT_OPTIONS.repeatPenalty],
    presencePenalty: [DEFAULT_OPTIONS.presencePenalty],
    frequencyPenalty: [DEFAULT_OPTIONS.frequencyPenalty],
    dryMultiplier: [DEFAULT_OPTIONS.dryMultiplier],
    dryBase: [DEFAULT_OPTIONS.dryBase],
    mirostat: [DEFAULT_OPTIONS.mirostat],
    dynatempRange: [DEFAULT_OPTIONS.dynatempRange],
    // Speculative
    modelDraft: [""],
    specDraftNMax: [DEFAULT_OPTIONS.specDraftNMax],
    nGpuLayersDraft: [DEFAULT_OPTIONS.nGpuLayersDraft],
    specDraftCacheTypeK: [DEFAULT_OPTIONS.specDraftCacheTypeK],
    specDraftCacheTypeV: [DEFAULT_OPTIONS.specDraftCacheTypeV],
    specType: [DEFAULT_OPTIONS.specType],
    specNgramModNMin: [DEFAULT_OPTIONS.specNgramModNMin],
    specNgramModNMax: [DEFAULT_OPTIONS.specNgramModNMax],
    specNgramModNMatch: [DEFAULT_OPTIONS.specNgramModNMatch],
    specNgramSimpleSizeN: [DEFAULT_OPTIONS.specNgramSimpleSizeN],
    specNgramSimpleSizeM: [DEFAULT_OPTIONS.specNgramSimpleSizeM],
    specNgramSimpleMinHits: [DEFAULT_OPTIONS.specNgramSimpleMinHits],
    // LoRA
    lora: [""],
    loraScaled: [""],
    // Server
    timeout: [DEFAULT_OPTIONS.timeout],
    threadsHttp: [DEFAULT_OPTIONS.threadsHttp],
    metrics: [DEFAULT_OPTIONS.metrics],
    slots: [DEFAULT_OPTIONS.slots],
    cachePrompt: [DEFAULT_OPTIONS.cachePrompt],
    cacheReuse: [DEFAULT_OPTIONS.cacheReuse],
    // Reasoning
    reasoning: [DEFAULT_OPTIONS.reasoning],
    reasoningBudget: [DEFAULT_OPTIONS.reasoningBudget],
    reasoningFormat: [DEFAULT_OPTIONS.reasoningFormat],
    // Auth
    apiKeyFile: [""],
  });

  /** Check whether a form control value differs from its compiled default. */
  isControlChanged(controlName: string): boolean {
    const val = this.form.get(controlName)?.value;
    return val !== undefined && isChanged(controlName, val);
  }

  /** Check whether any of the given controls differs from default (for panel-level highlighting). */
  isSectionChanged(...controlNames: string[]): boolean {
    return controlNames.some((name) => this.isControlChanged(name));
  }

  // ── Conditional signals ──

  readonly fitValue = computed(() => this.form.get("fit")?.value as string);
  readonly splitModeValue = computed(() => this.form.get("splitMode")?.value as string);
  readonly specTypeValue = computed(() => this.form.get("specType")?.value as string);
  readonly ropeScalingValue = computed(() => this.form.get("ropeScaling")?.value as string);

  readonly isTensorSplitDisabled = computed(() => this.splitModeValue() === "none");
  readonly isFitTargetDisabled = computed(() => this.fitValue() === "off");
  readonly showNgramParams = computed(() => {
    const v = this.specTypeValue();
    return v?.includes("ngram") ?? false;
  });
  readonly showYarnParams = computed(() => this.ropeScalingValue() === "yarn");

  ngOnInit(): void {
    this.form.controls.command.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => this._commandValue.set(v!));

    if (this.data.config) {
      this.populateFormFromFlags(this.data.config.flags);
    }

    // Load GPU devices for the device dropdown
    this.serviceService.getLlamaAutocomplete("device", "").subscribe({
      next: (suggestions) => {
        this.availableDevices.set(suggestions.map((s) => s.path));
      },
      error: () => {
        this.availableDevices.set([]);
      },
    });

    // Load host suggestions
    this.serviceService.getLlamaAutocomplete("host", "").subscribe({
      next: (suggestions) => {
        this.filteredHosts.set(suggestions);
      },
      error: () => {
        this.filteredHosts.set([]);
      },
    });

    // Setup host autocomplete

    (this.form.controls.host.valueChanges
      .pipe(
        takeUntilDestroyed(),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((value: string | null) => {
          const query = (value ?? "").trim();
          if (!query) return of<AutocompleteSuggestion[]>([]);
          return this.serviceService
            .getLlamaAutocomplete("host", query)
            .pipe(catchError(() => of<AutocompleteSuggestion[]>([])));
        }),
      )
      .subscribe((suggestions) => this.filteredHosts.set(suggestions)),
      this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
        this.cdr.markForCheck();
      }));
  }

  private populateFormFromFlags(flags: string[]): void {
    const f = this.form.controls;
    // Basic
    f.host.setValue(flagValueStr(flags, "--host", DEFAULT_OPTIONS.host));
    f.port.setValue(flagValueNum(flags, "--port", DEFAULT_OPTIONS.port));
    f.threads.setValue(flagValueNum(flags, "--threads", DEFAULT_OPTIONS.threads));
    f.flashAttn.setValue(flagValueStr(flags, "--flash-attn", DEFAULT_OPTIONS.flashAttn));
    f.fit.setValue(flagValueStr(flags, "--fit", DEFAULT_OPTIONS.fit));
    f.parallel.setValue(flagValueNum(flags, "--parallel", DEFAULT_OPTIONS.parallel));
    f.alias.setValue(flagValueStr(flags, "--alias", ""));
    f.nPredict.setValue(flagValueNum(flags, "--n-predict", DEFAULT_OPTIONS.nPredict));
    f.contextShift.setValue(flagBool(flags, "--context-shift", "--no-context-shift", false) ? "on" : "off");
    f.contBatching.setValue(flagBool(flags, "--cont-batching", "--no-cont-batching", true) ? "on" : "off");
    // GPU & Model
    const deviceVal = findFlag(flags, "--device");
    f.device.setValue(
      deviceVal
        ? deviceVal
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean)
        : [],
    );
    f.tensorSplit.setValue(flagValueStr(flags, "--tensor-split", ""));
    f.model.setValue(flagValueStr(flags, "--model", ""));
    f.mmproj.setValue(flagValueStr(flags, "--mmproj", ""));
    f.nGpuLayers.setValue(flagValueStr(flags, "--n-gpu-layers", DEFAULT_OPTIONS.nGpuLayers));
    f.splitMode.setValue(flagValueStr(flags, "--split-mode", DEFAULT_OPTIONS.splitMode));
    f.mainGpu.setValue(flagValueNum(flags, "--main-gpu", DEFAULT_OPTIONS.mainGpu));
    f.fitTarget.setValue(flagValueNum(flags, "--fit-target", DEFAULT_OPTIONS.fitTarget));
    f.fitCtx.setValue(flagValueNum(flags, "--fit-ctx", DEFAULT_OPTIONS.fitCtx));
    f.mlock.setValue(flags.includes("--mlock") ? "on" : "off");
    f.mmap.setValue(flagBool(flags, "--mmap", "--no-mmap", true) ? "on" : "off");
    f.cpuMoe.setValue(flags.includes("--cpu-moe") ? "on" : "off");
    f.nCpuMoe.setValue(flagValueNum(flags, "--n-cpu-moe", 0));
    // Context & KV Cache
    f.ctxSize.setValue(flagValueNum(flags, "--ctx-size", DEFAULT_OPTIONS.ctxSize));
    f.batchSize.setValue(flagValueNum(flags, "--batch-size", DEFAULT_OPTIONS.batchSize));
    f.ubatchSize.setValue(flagValueNum(flags, "--ubatch-size", DEFAULT_OPTIONS.ubatchSize));
    f.cacheTypeK.setValue(flagValueStr(flags, "--cache-type-k", DEFAULT_OPTIONS.cacheTypeK));
    f.cacheTypeV.setValue(flagValueStr(flags, "--cache-type-v", DEFAULT_OPTIONS.cacheTypeV));
    f.kvOffload.setValue(flagBool(flags, "--kv-offload", "--no-kv-offload", true) ? "on" : "off");
    f.cacheRam.setValue(flagValueNum(flags, "--cache-ram", DEFAULT_OPTIONS.cacheRam));
    f.swaFull.setValue(flags.includes("--swa-full") ? "on" : "off");
    // RoPE
    f.ropeScaling.setValue(flagValueStr(flags, "--rope-scaling", DEFAULT_OPTIONS.ropeScaling));
    f.ropeScale.setValue(flagValueFloat(flags, "--rope-scale", DEFAULT_OPTIONS.ropeScale));
    f.ropeFreqBase.setValue(flagValueFloat(flags, "--rope-freq-base", DEFAULT_OPTIONS.ropeFreqBase));
    f.ropeFreqScale.setValue(flagValueFloat(flags, "--rope-freq-scale", DEFAULT_OPTIONS.ropeFreqScale));
    f.yarnOrigCtx.setValue(flagValueNum(flags, "--yarn-orig-ctx", DEFAULT_OPTIONS.yarnOrigCtx));
    f.yarnExtFactor.setValue(flagValueFloat(flags, "--yarn-ext-factor", DEFAULT_OPTIONS.yarnExtFactor));
    f.yarnAttnFactor.setValue(flagValueFloat(flags, "--yarn-attn-factor", DEFAULT_OPTIONS.yarnAttnFactor));
    f.yarnBetaSlow.setValue(flagValueFloat(flags, "--yarn-beta-slow", DEFAULT_OPTIONS.yarnBetaSlow));
    f.yarnBetaFast.setValue(flagValueFloat(flags, "--yarn-beta-fast", DEFAULT_OPTIONS.yarnBetaFast));
    // Sampling
    f.temperature.setValue(flagValueFloat(flags, "--temperature", DEFAULT_OPTIONS.temperature));
    f.seed.setValue(flagValueNum(flags, "--seed", DEFAULT_OPTIONS.seed));
    f.topK.setValue(flagValueNum(flags, "--top-k", DEFAULT_OPTIONS.topK));
    f.topP.setValue(flagValueFloat(flags, "--top-p", DEFAULT_OPTIONS.topP));
    f.minP.setValue(flagValueFloat(flags, "--min-p", DEFAULT_OPTIONS.minP));
    f.typicalP.setValue(flagValueFloat(flags, "--typical", DEFAULT_OPTIONS.typicalP));
    f.repeatLastN.setValue(flagValueNum(flags, "--repeat-last-n", DEFAULT_OPTIONS.repeatLastN));
    f.repeatPenalty.setValue(flagValueFloat(flags, "--repeat-penalty", DEFAULT_OPTIONS.repeatPenalty));
    f.presencePenalty.setValue(flagValueFloat(flags, "--presence-penalty", DEFAULT_OPTIONS.presencePenalty));
    f.frequencyPenalty.setValue(flagValueFloat(flags, "--frequency-penalty", DEFAULT_OPTIONS.frequencyPenalty));
    f.dryMultiplier.setValue(flagValueFloat(flags, "--dry-multiplier", DEFAULT_OPTIONS.dryMultiplier));
    f.dryBase.setValue(flagValueFloat(flags, "--dry-base", DEFAULT_OPTIONS.dryBase));
    f.mirostat.setValue(flagValueNum(flags, "--mirostat", DEFAULT_OPTIONS.mirostat));
    f.dynatempRange.setValue(flagValueFloat(flags, "--dynatemp-range", DEFAULT_OPTIONS.dynatempRange));
    // Speculative
    f.modelDraft.setValue(flagValueStr(flags, "--model-draft", ""));
    f.specDraftNMax.setValue(flagValueNum(flags, "--spec-draft-n-max", DEFAULT_OPTIONS.specDraftNMax));
    f.nGpuLayersDraft.setValue(flagValueStr(flags, "--n-gpu-layers-draft", DEFAULT_OPTIONS.nGpuLayersDraft));
    f.specDraftCacheTypeK.setValue(flagValueStr(flags, "--cache-type-k-draft", DEFAULT_OPTIONS.specDraftCacheTypeK));
    f.specDraftCacheTypeV.setValue(flagValueStr(flags, "--cache-type-v-draft", DEFAULT_OPTIONS.specDraftCacheTypeV));
    f.specType.setValue(flagValueStr(flags, "--spec-type", DEFAULT_OPTIONS.specType));
    f.specNgramModNMin.setValue(flagValueNum(flags, "--spec-ngram-mod-n-min", DEFAULT_OPTIONS.specNgramModNMin));
    f.specNgramModNMax.setValue(flagValueNum(flags, "--spec-ngram-mod-n-max", DEFAULT_OPTIONS.specNgramModNMax));
    f.specNgramModNMatch.setValue(flagValueNum(flags, "--spec-ngram-mod-n-match", DEFAULT_OPTIONS.specNgramModNMatch));
    f.specNgramSimpleSizeN.setValue(
      flagValueNum(flags, "--spec-ngram-simple-size-n", DEFAULT_OPTIONS.specNgramSimpleSizeN),
    );
    f.specNgramSimpleSizeM.setValue(
      flagValueNum(flags, "--spec-ngram-simple-size-m", DEFAULT_OPTIONS.specNgramSimpleSizeM),
    );
    f.specNgramSimpleMinHits.setValue(
      flagValueNum(flags, "--spec-ngram-simple-min-hits", DEFAULT_OPTIONS.specNgramSimpleMinHits),
    );
    // LoRA
    f.lora.setValue(flagValueStr(flags, "--lora", ""));
    f.loraScaled.setValue(flagValueStr(flags, "--lora-scaled", ""));
    // Server
    f.timeout.setValue(flagValueNum(flags, "--timeout", DEFAULT_OPTIONS.timeout));
    f.threadsHttp.setValue(flagValueNum(flags, "--threads-http", DEFAULT_OPTIONS.threadsHttp));
    f.metrics.setValue(flags.includes("--metrics") ? "on" : "off");
    f.slots.setValue(flagBool(flags, "--slots", "--no-slots", true) ? "on" : "off");
    f.cachePrompt.setValue(flagBool(flags, "--cache-prompt", "--no-cache-prompt", true) ? "on" : "off");
    f.cacheReuse.setValue(flagValueNum(flags, "--cache-reuse", DEFAULT_OPTIONS.cacheReuse));
    // Reasoning
    f.reasoning.setValue(flagValueStr(flags, "--reasoning", DEFAULT_OPTIONS.reasoning));
    f.reasoningBudget.setValue(flagValueNum(flags, "--reasoning-budget", DEFAULT_OPTIONS.reasoningBudget));
    f.reasoningFormat.setValue(flagValueStr(flags, "--reasoning-format", DEFAULT_OPTIONS.reasoningFormat));
    // Auth
    f.apiKeyFile.setValue(flagValueStr(flags, "--api-key-file", ""));
  }

  /** Add flag only if value differs from default. Compares as strings for uniformity. */
  private addIf(flag: string, value: unknown, defaultVal: string | number): void {
    if (String(value) !== String(defaultVal)) {
      this._flags!.push(`${flag} ${value}`);
    }
  }

  /** Add flag only if value differs from default. For toggles: writes positive or negative flag. */
  private addToggle(value: string, positive: string, negative: string, defaultOn: boolean): void {
    const isOn = value === "on";
    if (isOn !== defaultOn) {
      this._flags!.push(isOn ? positive : negative);
    }
  }

  private _flags: string[] | null = null;

  buildFlags(): string[] {
    this._flags = [];
    const c = this.form.controls;

    // Basic
    this.addIf("--host", c.host.value, DEFAULT_OPTIONS.host);
    this.addIf("--port", c.port.value, DEFAULT_OPTIONS.port);
    this.addIf("--threads", c.threads.value, DEFAULT_OPTIONS.threads);
    this.addIf("--flash-attn", c.flashAttn.value, DEFAULT_OPTIONS.flashAttn);
    this.addIf("--fit", c.fit.value, DEFAULT_OPTIONS.fit);
    this.addIf("--parallel", c.parallel.value, DEFAULT_OPTIONS.parallel);
    this.addIf("--alias", c.alias.value, DEFAULT_OPTIONS.alias);
    this.addIf("--n-predict", c.nPredict.value, DEFAULT_OPTIONS.nPredict);
    this.addToggle(c.contextShift.value as string, "--context-shift", "--no-context-shift", false);
    this.addToggle(c.contBatching.value as string, "--cont-batching", "--no-cont-batching", true);

    // GPU & Model
    const deviceArr = c.device.value as string[];
    if (deviceArr && deviceArr.length > 0) {
      this._flags.push(`--device ${deviceArr.join(",")}`);
    }
    this.addIf("--tensor-split", c.tensorSplit.value, DEFAULT_OPTIONS.tensorSplit);
    this.addIf("--model", c.model.value, DEFAULT_OPTIONS.model);
    this.addIf("--mmproj", c.mmproj.value, DEFAULT_OPTIONS.mmproj);
    this.addIf("--n-gpu-layers", c.nGpuLayers.value, DEFAULT_OPTIONS.nGpuLayers);
    this.addIf("--split-mode", c.splitMode.value, DEFAULT_OPTIONS.splitMode);
    this.addIf("--main-gpu", c.mainGpu.value, DEFAULT_OPTIONS.mainGpu);
    this.addIf("--fit-target", c.fitTarget.value, DEFAULT_OPTIONS.fitTarget);
    this.addIf("--fit-ctx", c.fitCtx.value, DEFAULT_OPTIONS.fitCtx);
    if (c.mlock.value === "on") this._flags.push("--mlock");
    this.addToggle(c.mmap.value as string, "--mmap", "--no-mmap", true);
    if (c.cpuMoe.value === "on") this._flags.push("--cpu-moe");
    this.addIf("--n-cpu-moe", c.nCpuMoe.value, DEFAULT_OPTIONS.nCpuMoe);

    // Context & KV Cache
    this.addIf("--ctx-size", c.ctxSize.value, DEFAULT_OPTIONS.ctxSize);
    this.addIf("--batch-size", c.batchSize.value, DEFAULT_OPTIONS.batchSize);
    this.addIf("--ubatch-size", c.ubatchSize.value, DEFAULT_OPTIONS.ubatchSize);
    this.addIf("--cache-type-k", c.cacheTypeK.value, DEFAULT_OPTIONS.cacheTypeK);
    this.addIf("--cache-type-v", c.cacheTypeV.value, DEFAULT_OPTIONS.cacheTypeV);
    this.addToggle(c.kvOffload.value as string, "--kv-offload", "--no-kv-offload", true);
    this.addIf("--cache-ram", c.cacheRam.value, DEFAULT_OPTIONS.cacheRam);
    if (c.swaFull.value === "on") this._flags.push("--swa-full");

    // RoPE
    const ropeScaling = c.ropeScaling.value as string;
    if (ropeScaling && ropeScaling !== DEFAULT_OPTIONS.ropeScaling) {
      this._flags.push(`--rope-scaling ${ropeScaling}`);
      this.addIf("--rope-scale", c.ropeScale.value, DEFAULT_OPTIONS.ropeScale);
      this.addIf("--rope-freq-base", c.ropeFreqBase.value, DEFAULT_OPTIONS.ropeFreqBase);
      this.addIf("--rope-freq-scale", c.ropeFreqScale.value, DEFAULT_OPTIONS.ropeFreqScale);
      if (ropeScaling === "yarn") {
        this.addIf("--yarn-orig-ctx", c.yarnOrigCtx.value, DEFAULT_OPTIONS.yarnOrigCtx);
        this.addIf("--yarn-ext-factor", c.yarnExtFactor.value, DEFAULT_OPTIONS.yarnExtFactor);
        this.addIf("--yarn-attn-factor", c.yarnAttnFactor.value, DEFAULT_OPTIONS.yarnAttnFactor);
        this.addIf("--yarn-beta-slow", c.yarnBetaSlow.value, DEFAULT_OPTIONS.yarnBetaSlow);
        this.addIf("--yarn-beta-fast", c.yarnBetaFast.value, DEFAULT_OPTIONS.yarnBetaFast);
      }
    }

    // Sampling
    this.addIf("--temperature", c.temperature.value, DEFAULT_OPTIONS.temperature);
    this.addIf("--seed", c.seed.value, DEFAULT_OPTIONS.seed);
    this.addIf("--top-k", c.topK.value, DEFAULT_OPTIONS.topK);
    this.addIf("--top-p", c.topP.value, DEFAULT_OPTIONS.topP);
    this.addIf("--min-p", c.minP.value, DEFAULT_OPTIONS.minP);
    this.addIf("--typical", c.typicalP.value, DEFAULT_OPTIONS.typicalP);
    this.addIf("--repeat-last-n", c.repeatLastN.value, DEFAULT_OPTIONS.repeatLastN);
    this.addIf("--repeat-penalty", c.repeatPenalty.value, DEFAULT_OPTIONS.repeatPenalty);
    this.addIf("--presence-penalty", c.presencePenalty.value, DEFAULT_OPTIONS.presencePenalty);
    this.addIf("--frequency-penalty", c.frequencyPenalty.value, DEFAULT_OPTIONS.frequencyPenalty);
    this.addIf("--dry-multiplier", c.dryMultiplier.value, DEFAULT_OPTIONS.dryMultiplier);
    this.addIf("--dry-base", c.dryBase.value, DEFAULT_OPTIONS.dryBase);
    this.addIf("--mirostat", c.mirostat.value, DEFAULT_OPTIONS.mirostat);
    this.addIf("--dynatemp-range", c.dynatempRange.value, DEFAULT_OPTIONS.dynatempRange);

    // Speculative
    this.addIf("--model-draft", c.modelDraft.value, DEFAULT_OPTIONS.modelDraft);
    this.addIf("--spec-draft-n-max", c.specDraftNMax.value, DEFAULT_OPTIONS.specDraftNMax);
    this.addIf("--n-gpu-layers-draft", c.nGpuLayersDraft.value, DEFAULT_OPTIONS.nGpuLayersDraft);
    this.addIf("--cache-type-k-draft", c.specDraftCacheTypeK.value, DEFAULT_OPTIONS.specDraftCacheTypeK);
    this.addIf("--cache-type-v-draft", c.specDraftCacheTypeV.value, DEFAULT_OPTIONS.specDraftCacheTypeV);
    this.addIf("--spec-type", c.specType.value, DEFAULT_OPTIONS.specType);
    const specType = c.specType.value as string;
    if (specType?.includes("ngram")) {
      this.addIf("--spec-ngram-mod-n-min", c.specNgramModNMin.value, DEFAULT_OPTIONS.specNgramModNMin);
      this.addIf("--spec-ngram-mod-n-max", c.specNgramModNMax.value, DEFAULT_OPTIONS.specNgramModNMax);
      this.addIf("--spec-ngram-mod-n-match", c.specNgramModNMatch.value, DEFAULT_OPTIONS.specNgramModNMatch);
      this.addIf("--spec-ngram-simple-size-n", c.specNgramSimpleSizeN.value, DEFAULT_OPTIONS.specNgramSimpleSizeN);
      this.addIf("--spec-ngram-simple-size-m", c.specNgramSimpleSizeM.value, DEFAULT_OPTIONS.specNgramSimpleSizeM);
      this.addIf(
        "--spec-ngram-simple-min-hits",
        c.specNgramSimpleMinHits.value,
        DEFAULT_OPTIONS.specNgramSimpleMinHits,
      );
    }

    // LoRA
    this.addIf("--lora", c.lora.value, DEFAULT_OPTIONS.lora);
    this.addIf("--lora-scaled", c.loraScaled.value, DEFAULT_OPTIONS.loraScaled);

    // Server
    this.addIf("--timeout", c.timeout.value, DEFAULT_OPTIONS.timeout);
    this.addIf("--threads-http", c.threadsHttp.value, DEFAULT_OPTIONS.threadsHttp);
    if (c.metrics.value === "on") this._flags.push("--metrics");
    this.addToggle(c.slots.value as string, "--slots", "--no-slots", true);
    this.addToggle(c.cachePrompt.value as string, "--cache-prompt", "--no-cache-prompt", true);
    this.addIf("--cache-reuse", c.cacheReuse.value, DEFAULT_OPTIONS.cacheReuse);

    // Reasoning
    this.addIf("--reasoning", c.reasoning.value, DEFAULT_OPTIONS.reasoning);
    this.addIf("--reasoning-budget", c.reasoningBudget.value, DEFAULT_OPTIONS.reasoningBudget);
    this.addIf("--reasoning-format", c.reasoningFormat.value, DEFAULT_OPTIONS.reasoningFormat);

    // Auth
    this.addIf("--api-key-file", c.apiKeyFile.value, DEFAULT_OPTIONS.apiKeyFile);

    const result = this._flags;
    this._flags = null;
    return result;
  }

  save(): void {
    if (this.form.invalid) return;

    const cfg: ServiceConfig = {
      name: this.form.controls.name.value!.trim(),
      type: "llama-server" as ServiceType,
      command: this.form.controls.command.value!.trim(),
      flags: this.buildFlags(),
    };

    this.dialogRef.close(cfg);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
