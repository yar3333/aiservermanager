import { Component, Inject, inject, signal, computed, OnInit, OnDestroy } from "@angular/core";
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
import { Subscription, of } from "rxjs";
import { debounceTime, distinctUntilChanged, switchMap, catchError } from "rxjs/operators";

export interface LlamaServerDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select). */
  allConfigs?: ServiceConfig[];
}

const DEFAULT_OPTIONS = {
  // Basic
  host: "0.0.0.0",
  port: 4239,
  threads: 8,
  flashAttn: "on",
  fit: "off",
  parallel: 2,
  alias: "",
  nPredict: -1,
  contextShift: "off",
  contBatching: "on",
  // GPU & Model
  model: "",
  mmproj: "",
  nGpuLayers: 999,
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
  ctxSize: 524288,
  batchSize: 1024,
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
  specDraftNMax: 6,
  nGpuLayersDraft: 999,
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
  reasoningFormat: "none",
  // Auth
  apiKeyFile: "",
};

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
export class LlamaServerDialogComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<LlamaServerDialogComponent>);
  private data: LlamaServerDialogData = inject(MAT_DIALOG_DATA);
  private serviceService = inject(ServiceService);
  private subs = new Subscription();

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

  get nameControl() {
    return this.form.get("name")!;
  }
  get commandControl() {
    return this.form.get("command")!;
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
    this.commandControl.valueChanges.subscribe((v) => this._commandValue.set(v as string));
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
    this.subs.add(
      this.form
        .get("host")!
        .valueChanges.pipe(
          debounceTime(250),
          distinctUntilChanged(),
          switchMap((value: string | null) => {
            const query = ((value as string) ?? "").trim();
            if (!query) return of<AutocompleteSuggestion[]>([]);
            return this.serviceService
              .getLlamaAutocomplete("host", query)
              .pipe(catchError(() => of<AutocompleteSuggestion[]>([])));
          }),
        )
        .subscribe((suggestions) => this.filteredHosts.set(suggestions)),
    );
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  private populateFormFromFlags(flags: string[]): void {
    const f = this.form;
    // Basic
    f.get("host")!.setValue(flagValueStr(flags, "--host", DEFAULT_OPTIONS.host));
    f.get("port")!.setValue(flagValueNum(flags, "--port", DEFAULT_OPTIONS.port));
    f.get("threads")!.setValue(flagValueNum(flags, "--threads", DEFAULT_OPTIONS.threads));
    f.get("flashAttn")!.setValue(flagValueStr(flags, "--flash-attn", DEFAULT_OPTIONS.flashAttn));
    f.get("fit")!.setValue(flagValueStr(flags, "--fit", DEFAULT_OPTIONS.fit));
    f.get("parallel")!.setValue(flagValueNum(flags, "--parallel", DEFAULT_OPTIONS.parallel));
    f.get("alias")!.setValue(flagValueStr(flags, "--alias", ""));
    f.get("nPredict")!.setValue(flagValueNum(flags, "--n-predict", DEFAULT_OPTIONS.nPredict));
    f.get("contextShift")!.setValue(flagBool(flags, "--context-shift", "--no-context-shift", false) ? "on" : "off");
    f.get("contBatching")!.setValue(flagBool(flags, "--cont-batching", "--no-cont-batching", true) ? "on" : "off");
    // GPU & Model
    const deviceVal = findFlag(flags, "--device");
    f.get("device")!.setValue(
      deviceVal
        ? deviceVal
            .split(",")
            .map((d) => d.trim())
            .filter(Boolean)
        : [],
    );
    f.get("tensorSplit")!.setValue(flagValueStr(flags, "--tensor-split", ""));
    f.get("model")!.setValue(flagValueStr(flags, "--model", ""));
    f.get("mmproj")!.setValue(flagValueStr(flags, "--mmproj", ""));
    f.get("nGpuLayers")!.setValue(flagValueNum(flags, "--n-gpu-layers", DEFAULT_OPTIONS.nGpuLayers));
    f.get("splitMode")!.setValue(flagValueStr(flags, "--split-mode", DEFAULT_OPTIONS.splitMode));
    f.get("mainGpu")!.setValue(flagValueNum(flags, "--main-gpu", DEFAULT_OPTIONS.mainGpu));
    f.get("fitTarget")!.setValue(flagValueNum(flags, "--fit-target", DEFAULT_OPTIONS.fitTarget));
    f.get("fitCtx")!.setValue(flagValueNum(flags, "--fit-ctx", DEFAULT_OPTIONS.fitCtx));
    f.get("mlock")!.setValue(flags.includes("--mlock") ? "on" : "off");
    f.get("mmap")!.setValue(flagBool(flags, "--mmap", "--no-mmap", true) ? "on" : "off");
    f.get("cpuMoe")!.setValue(flags.includes("--cpu-moe") ? "on" : "off");
    f.get("nCpuMoe")!.setValue(flagValueNum(flags, "--n-cpu-moe", 0));
    // Context & KV Cache
    f.get("ctxSize")!.setValue(flagValueNum(flags, "--ctx-size", DEFAULT_OPTIONS.ctxSize));
    f.get("batchSize")!.setValue(flagValueNum(flags, "--batch-size", DEFAULT_OPTIONS.batchSize));
    f.get("ubatchSize")!.setValue(flagValueNum(flags, "--ubatch-size", DEFAULT_OPTIONS.ubatchSize));
    f.get("cacheTypeK")!.setValue(flagValueStr(flags, "--cache-type-k", DEFAULT_OPTIONS.cacheTypeK));
    f.get("cacheTypeV")!.setValue(flagValueStr(flags, "--cache-type-v", DEFAULT_OPTIONS.cacheTypeV));
    f.get("kvOffload")!.setValue(flagBool(flags, "--kv-offload", "--no-kv-offload", true) ? "on" : "off");
    f.get("cacheRam")!.setValue(flagValueNum(flags, "--cache-ram", DEFAULT_OPTIONS.cacheRam));
    f.get("swaFull")!.setValue(flags.includes("--swa-full") ? "on" : "off");
    // RoPE
    f.get("ropeScaling")!.setValue(flagValueStr(flags, "--rope-scaling", DEFAULT_OPTIONS.ropeScaling));
    f.get("ropeScale")!.setValue(flagValueFloat(flags, "--rope-scale", DEFAULT_OPTIONS.ropeScale));
    f.get("ropeFreqBase")!.setValue(flagValueFloat(flags, "--rope-freq-base", DEFAULT_OPTIONS.ropeFreqBase));
    f.get("ropeFreqScale")!.setValue(flagValueFloat(flags, "--rope-freq-scale", DEFAULT_OPTIONS.ropeFreqScale));
    f.get("yarnOrigCtx")!.setValue(flagValueNum(flags, "--yarn-orig-ctx", DEFAULT_OPTIONS.yarnOrigCtx));
    f.get("yarnExtFactor")!.setValue(flagValueFloat(flags, "--yarn-ext-factor", DEFAULT_OPTIONS.yarnExtFactor));
    f.get("yarnAttnFactor")!.setValue(flagValueFloat(flags, "--yarn-attn-factor", DEFAULT_OPTIONS.yarnAttnFactor));
    f.get("yarnBetaSlow")!.setValue(flagValueFloat(flags, "--yarn-beta-slow", DEFAULT_OPTIONS.yarnBetaSlow));
    f.get("yarnBetaFast")!.setValue(flagValueFloat(flags, "--yarn-beta-fast", DEFAULT_OPTIONS.yarnBetaFast));
    // Sampling
    f.get("temperature")!.setValue(flagValueFloat(flags, "--temperature", DEFAULT_OPTIONS.temperature));
    f.get("seed")!.setValue(flagValueNum(flags, "--seed", DEFAULT_OPTIONS.seed));
    f.get("topK")!.setValue(flagValueNum(flags, "--top-k", DEFAULT_OPTIONS.topK));
    f.get("topP")!.setValue(flagValueFloat(flags, "--top-p", DEFAULT_OPTIONS.topP));
    f.get("minP")!.setValue(flagValueFloat(flags, "--min-p", DEFAULT_OPTIONS.minP));
    f.get("typicalP")!.setValue(flagValueFloat(flags, "--typical", DEFAULT_OPTIONS.typicalP));
    f.get("repeatLastN")!.setValue(flagValueNum(flags, "--repeat-last-n", DEFAULT_OPTIONS.repeatLastN));
    f.get("repeatPenalty")!.setValue(flagValueFloat(flags, "--repeat-penalty", DEFAULT_OPTIONS.repeatPenalty));
    f.get("presencePenalty")!.setValue(flagValueFloat(flags, "--presence-penalty", DEFAULT_OPTIONS.presencePenalty));
    f.get("frequencyPenalty")!.setValue(flagValueFloat(flags, "--frequency-penalty", DEFAULT_OPTIONS.frequencyPenalty));
    f.get("dryMultiplier")!.setValue(flagValueFloat(flags, "--dry-multiplier", DEFAULT_OPTIONS.dryMultiplier));
    f.get("dryBase")!.setValue(flagValueFloat(flags, "--dry-base", DEFAULT_OPTIONS.dryBase));
    f.get("mirostat")!.setValue(flagValueNum(flags, "--mirostat", DEFAULT_OPTIONS.mirostat));
    f.get("dynatempRange")!.setValue(flagValueFloat(flags, "--dynatemp-range", DEFAULT_OPTIONS.dynatempRange));
    // Speculative
    f.get("modelDraft")!.setValue(flagValueStr(flags, "--model-draft", ""));
    f.get("specDraftNMax")!.setValue(flagValueNum(flags, "--spec-draft-n-max", DEFAULT_OPTIONS.specDraftNMax));
    f.get("nGpuLayersDraft")!.setValue(flagValueNum(flags, "--n-gpu-layers-draft", DEFAULT_OPTIONS.nGpuLayersDraft));
    f.get("specDraftCacheTypeK")!.setValue(
      flagValueStr(flags, "--cache-type-k-draft", DEFAULT_OPTIONS.specDraftCacheTypeK),
    );
    f.get("specDraftCacheTypeV")!.setValue(
      flagValueStr(flags, "--cache-type-v-draft", DEFAULT_OPTIONS.specDraftCacheTypeV),
    );
    f.get("specType")!.setValue(flagValueStr(flags, "--spec-type", DEFAULT_OPTIONS.specType));
    f.get("specNgramModNMin")!.setValue(
      flagValueNum(flags, "--spec-ngram-mod-n-min", DEFAULT_OPTIONS.specNgramModNMin),
    );
    f.get("specNgramModNMax")!.setValue(
      flagValueNum(flags, "--spec-ngram-mod-n-max", DEFAULT_OPTIONS.specNgramModNMax),
    );
    f.get("specNgramModNMatch")!.setValue(
      flagValueNum(flags, "--spec-ngram-mod-n-match", DEFAULT_OPTIONS.specNgramModNMatch),
    );
    f.get("specNgramSimpleSizeN")!.setValue(
      flagValueNum(flags, "--spec-ngram-simple-size-n", DEFAULT_OPTIONS.specNgramSimpleSizeN),
    );
    f.get("specNgramSimpleSizeM")!.setValue(
      flagValueNum(flags, "--spec-ngram-simple-size-m", DEFAULT_OPTIONS.specNgramSimpleSizeM),
    );
    f.get("specNgramSimpleMinHits")!.setValue(
      flagValueNum(flags, "--spec-ngram-simple-min-hits", DEFAULT_OPTIONS.specNgramSimpleMinHits),
    );
    // LoRA
    f.get("lora")!.setValue(flagValueStr(flags, "--lora", ""));
    f.get("loraScaled")!.setValue(flagValueStr(flags, "--lora-scaled", ""));
    // Server
    f.get("timeout")!.setValue(flagValueNum(flags, "--timeout", DEFAULT_OPTIONS.timeout));
    f.get("threadsHttp")!.setValue(flagValueNum(flags, "--threads-http", DEFAULT_OPTIONS.threadsHttp));
    f.get("metrics")!.setValue(flags.includes("--metrics") ? "on" : "off");
    f.get("slots")!.setValue(flagBool(flags, "--slots", "--no-slots", true) ? "on" : "off");
    f.get("cachePrompt")!.setValue(flagBool(flags, "--cache-prompt", "--no-cache-prompt", true) ? "on" : "off");
    f.get("cacheReuse")!.setValue(flagValueNum(flags, "--cache-reuse", DEFAULT_OPTIONS.cacheReuse));
    // Reasoning
    f.get("reasoning")!.setValue(flagValueStr(flags, "--reasoning", DEFAULT_OPTIONS.reasoning));
    f.get("reasoningBudget")!.setValue(flagValueNum(flags, "--reasoning-budget", DEFAULT_OPTIONS.reasoningBudget));
    f.get("reasoningFormat")!.setValue(flagValueStr(flags, "--reasoning-format", DEFAULT_OPTIONS.reasoningFormat));
    // Auth
    f.get("apiKeyFile")!.setValue(flagValueStr(flags, "--api-key-file", ""));
  }

  buildFlags(): string[] {
    const flags: string[] = [];
    const f = this.form;
    const add = (flag: string, value: string | number | null | undefined) => {
      if (value !== null && value !== undefined && value !== "") {
        flags.push(`${flag} ${value}`);
      }
    };
    const addBool = (value: string, positive: string, negative: string, defaultOn: boolean) => {
      const isOn = value === "on";
      if (isOn !== defaultOn) {
        flags.push(isOn ? positive : negative);
      }
    };

    // Basic
    add("--host", f.get("host")!.value);
    add("--port", f.get("port")!.value);
    add("--threads", f.get("threads")!.value);
    add("--flash-attn", f.get("flashAttn")!.value);
    add("--fit", f.get("fit")!.value);
    add("--parallel", f.get("parallel")!.value);
    add("--alias", f.get("alias")!.value);
    add("--n-predict", f.get("nPredict")!.value);
    addBool(f.get("contextShift")!.value as string, "--context-shift", "--no-context-shift", false);
    addBool(f.get("contBatching")!.value as string, "--cont-batching", "--no-cont-batching", true);

    // GPU & Model
    const deviceArr = f.get("device")!.value as string[];
    if (deviceArr && deviceArr.length > 0) {
      flags.push(`--device ${deviceArr.join(",")}`);
    }
    add("--tensor-split", f.get("tensorSplit")!.value);
    add("--model", f.get("model")!.value);
    add("--mmproj", f.get("mmproj")!.value);
    add("--n-gpu-layers", f.get("nGpuLayers")!.value);
    add("--split-mode", f.get("splitMode")!.value);
    add("--main-gpu", f.get("mainGpu")!.value);
    add("--fit-target", f.get("fitTarget")!.value);
    add("--fit-ctx", f.get("fitCtx")!.value);
    if (f.get("mlock")!.value === "on") flags.push("--mlock");
    addBool(f.get("mmap")!.value as string, "--mmap", "--no-mmap", true);
    if (f.get("cpuMoe")!.value === "on") flags.push("--cpu-moe");
    add("--n-cpu-moe", f.get("nCpuMoe")!.value);

    // Context & KV Cache
    add("--ctx-size", f.get("ctxSize")!.value);
    add("--batch-size", f.get("batchSize")!.value);
    add("--ubatch-size", f.get("ubatchSize")!.value);
    add("--cache-type-k", f.get("cacheTypeK")!.value);
    add("--cache-type-v", f.get("cacheTypeV")!.value);
    addBool(f.get("kvOffload")!.value as string, "--kv-offload", "--no-kv-offload", true);
    add("--cache-ram", f.get("cacheRam")!.value);
    if (f.get("swaFull")!.value === "on") flags.push("--swa-full");

    // RoPE
    const ropeScaling = f.get("ropeScaling")!.value;
    if (ropeScaling && ropeScaling !== "none") {
      add("--rope-scaling", ropeScaling);
      add("--rope-scale", f.get("ropeScale")!.value);
      add("--rope-freq-base", f.get("ropeFreqBase")!.value);
      add("--rope-freq-scale", f.get("ropeFreqScale")!.value);
      if (ropeScaling === "yarn") {
        add("--yarn-orig-ctx", f.get("yarnOrigCtx")!.value);
        add("--yarn-ext-factor", f.get("yarnExtFactor")!.value);
        add("--yarn-attn-factor", f.get("yarnAttnFactor")!.value);
        add("--yarn-beta-slow", f.get("yarnBetaSlow")!.value);
        add("--yarn-beta-fast", f.get("yarnBetaFast")!.value);
      }
    }

    // Sampling
    add("--temperature", f.get("temperature")!.value);
    add("--seed", f.get("seed")!.value);
    add("--top-k", f.get("topK")!.value);
    add("--top-p", f.get("topP")!.value);
    add("--min-p", f.get("minP")!.value);
    add("--typical", f.get("typicalP")!.value);
    add("--repeat-last-n", f.get("repeatLastN")!.value);
    add("--repeat-penalty", f.get("repeatPenalty")!.value);
    add("--presence-penalty", f.get("presencePenalty")!.value);
    add("--frequency-penalty", f.get("frequencyPenalty")!.value);
    add("--dry-multiplier", f.get("dryMultiplier")!.value);
    add("--dry-base", f.get("dryBase")!.value);
    add("--mirostat", f.get("mirostat")!.value);
    add("--dynatemp-range", f.get("dynatempRange")!.value);

    // Speculative
    add("--model-draft", f.get("modelDraft")!.value);
    add("--spec-draft-n-max", f.get("specDraftNMax")!.value);
    add("--n-gpu-layers-draft", f.get("nGpuLayersDraft")!.value);
    add("--cache-type-k-draft", f.get("specDraftCacheTypeK")!.value);
    add("--cache-type-v-draft", f.get("specDraftCacheTypeV")!.value);
    add("--spec-type", f.get("specType")!.value);
    const specType = f.get("specType")!.value as string;
    if (specType?.includes("ngram")) {
      add("--spec-ngram-mod-n-min", f.get("specNgramModNMin")!.value);
      add("--spec-ngram-mod-n-max", f.get("specNgramModNMax")!.value);
      add("--spec-ngram-mod-n-match", f.get("specNgramModNMatch")!.value);
      add("--spec-ngram-simple-size-n", f.get("specNgramSimpleSizeN")!.value);
      add("--spec-ngram-simple-size-m", f.get("specNgramSimpleSizeM")!.value);
      add("--spec-ngram-simple-min-hits", f.get("specNgramSimpleMinHits")!.value);
    }

    // LoRA
    add("--lora", f.get("lora")!.value);
    add("--lora-scaled", f.get("loraScaled")!.value);

    // Server
    add("--timeout", f.get("timeout")!.value);
    add("--threads-http", f.get("threadsHttp")!.value);
    if (f.get("metrics")!.value === "on") flags.push("--metrics");
    addBool(f.get("slots")!.value as string, "--slots", "--no-slots", true);
    addBool(f.get("cachePrompt")!.value as string, "--cache-prompt", "--no-cache-prompt", true);
    add("--cache-reuse", f.get("cacheReuse")!.value);

    // Reasoning
    add("--reasoning", f.get("reasoning")!.value);
    add("--reasoning-budget", f.get("reasoningBudget")!.value);
    add("--reasoning-format", f.get("reasoningFormat")!.value);

    // Auth
    add("--api-key-file", f.get("apiKeyFile")!.value);

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
