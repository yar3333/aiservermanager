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
import { MatSelectModule } from "@angular/material/select";
import { MatTooltipModule } from "@angular/material/tooltip";
import { ServiceConfig, ServiceType } from "../../../models/service";
import { ServiceService, AutocompleteSuggestion } from "../../../services/service.service";
import { findFlag, findAllFlags } from "./flag-parsing";
import { parseContextSize, formatContextSize, CONTEXT_PRESETS } from "../../../utils/context-size";
import { of, debounceTime, distinctUntilChanged, switchMap, catchError, startWith } from "rxjs";
import { takeUntilDestroyed, toSignal } from "@angular/core/rxjs-interop";

export interface VllmDialogData {
  /** Existing config for edit mode, or null for create. */
  config: ServiceConfig | null;
  /** All user-created configs (for command quick-select). */
  allConfigs?: ServiceConfig[];
  /** Clone mode: prefill from an existing config but create a new service (name stays editable). */
  clone?: boolean;
}

const DEFAULT_OPTIONS = {
  // Identity
  host: "127.0.0.1",
  port: 8000,
  servedModelName: "",
  // Model
  model: "",
  tokenizer: "",
  dtype: "auto",
  // Parallelism & Memory
  tensorParallelSize: 1,
  pipelineParallelSize: 1,
  maxParallelLoadingWorkers: 0,
  gpuMemoryUtilization: 0.9,
  swapSpace: 4,
  cpuOffloadGb: 0,
  kvCacheMemory: 0,
  device: "",
  attentionBackend: "",
  // Context & Scheduling
  maxModelLen: 0,
  // maxModelLen is stored as a formatted string ("256K", "262144"); 0 = from model metadata.
  maxNumSeqs: 256,
  maxNumBatchedTokens: 0,
  blockSize: 0,
  enableChunkedPrefill: "auto",
  // Speculative decoding
  specMethod: "none",
  specTokens: 0,
  specDraftModel: "",
  specDraftTensorParallelSize: 0,
  specNumDraftTokens: 0,
  // Sampling defaults
  temperature: 1.0,
  topP: 1.0,
  topK: -1,
  minP: 0.0,
  seed: -1,
  repetitionPenalty: 1.0,
  maxNumSeq: 0,
  // Tools & chat
  trustRemoteCode: false,
  enableAutoToolChoice: false,
  toolCallParser: "",
  reasoningParser: "",
  enablePrefixCaching: "auto",
  // Server
  apiKey: "",
  // Extra flags + env (free-form)
  extraFlags: "",
  envText: "",
};

/** Return true when the current form value differs from its compiled default. */
function isChanged(controlName: string, formValue: unknown): boolean {
  const defaultVal = (DEFAULT_OPTIONS as Record<string, unknown>)[controlName];
  if (defaultVal === undefined) return false;
  return String(formValue) !== String(defaultVal);
}

const NAME_REGEX = "^[a-zA-Z][a-zA-Z0-9_-]{0,127}$";

const DTYPE_OPTIONS = ["auto", "half", "bfloat16", "float", "float16", "float32"];
const ATTENTION_BACKENDS = [
  "TRITON_ATTN",
  "ROCM_ATTN",
  "ROCM_SEGMENTED_ATTN",
  "FLASH_ATTN",
  "FLASHINFER",
  "TRITON_MLA",
  "FLASHMLA",
  "FLEX_ATTENTION",
  "TORCH_SDPA",
  "TREE_ATTN",
  "XFORMERS",
];
const SPEC_METHODS = [
  { value: "none", label: "none" },
  { value: "ngram", label: "ngram" },
  { value: "eagle", label: "eagle" },
  { value: "eagle3", label: "eagle3" },
  { value: "medusa", label: "medusa" },
  { value: "mlp_speculator", label: "mlp_speculator" },
  { value: "draft_model", label: "draft_model" },
  { value: "mtp", label: "mtp" },
  { value: "qwen3_5_mtp", label: "qwen3_5_mtp" },
  { value: "qwen3_next_mtp", label: "qwen3_next_mtp" },
  { value: "deepseek_mtp", label: "deepseek_mtp" },
];
const TOOL_CALL_PARSERS = [
  "",
  "hermes",
  "mistral",
  "llama3_json",
  "qwen3_xml",
  "qwen25_tool_call",
  "phi4_mini_json",
  "pythonic",
  "internlm",
  "glm45",
  "step3",
  "minimax_m2",
];
const REASONING_PARSERS = ["", "deepseek_r1", "qwen3", "granite", "phi4_reasoning", "glm45", "step3", "minimax_m2"];

@Component({
  selector: "app-vllm-dialog",
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
  ],
  templateUrl: "./vllm-dialog.component.html",
  styleUrls: ["./vllm-dialog.component.scss"],
})
export class VllmDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private dialogRef = inject(MatDialogRef<VllmDialogComponent>);
  private data: VllmDialogData = inject(MAT_DIALOG_DATA);
  private serviceService = inject(ServiceService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  readonly isEdit = this.data.config !== null;
  readonly isClone = this.data.clone === true;

  readonly dtypeOptions = DTYPE_OPTIONS;
  readonly attentionBackends = ATTENTION_BACKENDS;
  readonly specMethods = SPEC_METHODS;
  readonly toolCallParsers = TOOL_CALL_PARSERS;
  readonly reasoningParsers = REASONING_PARSERS;

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
    name: [this.data.config?.name ?? "", { validators: [Validators.required, Validators.pattern(NAME_REGEX)] }],
    command: [this.data.config?.command ?? "", Validators.required],
    // Identity
    host: [DEFAULT_OPTIONS.host],
    port: [DEFAULT_OPTIONS.port],
    servedModelName: [DEFAULT_OPTIONS.servedModelName],
    // Model
    model: [DEFAULT_OPTIONS.model],
    tokenizer: [DEFAULT_OPTIONS.tokenizer],
    dtype: [DEFAULT_OPTIONS.dtype],
    // Parallelism & Memory
    tensorParallelSize: [DEFAULT_OPTIONS.tensorParallelSize],
    pipelineParallelSize: [DEFAULT_OPTIONS.pipelineParallelSize],
    maxParallelLoadingWorkers: [DEFAULT_OPTIONS.maxParallelLoadingWorkers],
    gpuMemoryUtilization: [DEFAULT_OPTIONS.gpuMemoryUtilization],
    swapSpace: [DEFAULT_OPTIONS.swapSpace],
    cpuOffloadGb: [DEFAULT_OPTIONS.cpuOffloadGb],
    kvCacheMemory: [DEFAULT_OPTIONS.kvCacheMemory],
    device: [DEFAULT_OPTIONS.device],
    attentionBackend: [DEFAULT_OPTIONS.attentionBackend],
    // Context & Scheduling
    maxModelLen: [""],
    maxNumSeqs: [DEFAULT_OPTIONS.maxNumSeqs],
    maxNumBatchedTokens: [DEFAULT_OPTIONS.maxNumBatchedTokens],
    blockSize: [DEFAULT_OPTIONS.blockSize],
    enableChunkedPrefill: [DEFAULT_OPTIONS.enableChunkedPrefill],
    // Speculative decoding
    specMethod: [DEFAULT_OPTIONS.specMethod],
    specTokens: [DEFAULT_OPTIONS.specTokens],
    specDraftModel: [DEFAULT_OPTIONS.specDraftModel],
    specDraftTensorParallelSize: [DEFAULT_OPTIONS.specDraftTensorParallelSize],
    specNumDraftTokens: [DEFAULT_OPTIONS.specNumDraftTokens],
    // Sampling defaults
    temperature: [DEFAULT_OPTIONS.temperature],
    topP: [DEFAULT_OPTIONS.topP],
    topK: [DEFAULT_OPTIONS.topK],
    minP: [DEFAULT_OPTIONS.minP],
    seed: [DEFAULT_OPTIONS.seed],
    repetitionPenalty: [DEFAULT_OPTIONS.repetitionPenalty],
    maxNumSeq: [DEFAULT_OPTIONS.maxNumSeq],
    // Tools & chat
    trustRemoteCode: [DEFAULT_OPTIONS.trustRemoteCode],
    enableAutoToolChoice: [DEFAULT_OPTIONS.enableAutoToolChoice],
    toolCallParser: [DEFAULT_OPTIONS.toolCallParser],
    reasoningParser: [DEFAULT_OPTIONS.reasoningParser],
    enablePrefixCaching: [DEFAULT_OPTIONS.enablePrefixCaching],
    // Server
    apiKey: [DEFAULT_OPTIONS.apiKey],
    // Extra flags + env (free-form)
    extraFlags: [DEFAULT_OPTIONS.extraFlags],
    envText: [DEFAULT_OPTIONS.envText],
  });

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

  // ── Existing values from other configs (for empty-input autocomplete) ──

  readonly existingModelPaths = computed<string[]>(() => this.extractConfigModelPaths());

  /** Unique `serve <model>` values from other configs (first flag line without "--"). */
  private extractConfigModelPaths(): string[] {
    const all = this.data.allConfigs ?? [];
    const currentName = this.data.config?.name ?? null;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const cfg of all) {
      if (cfg.name === currentName) continue;
      if (!cfg.flags) continue;
      const val = findFlag(cfg.flags, "serve");
      if (val && !seen.has(val)) {
        seen.add(val);
        result.push(val);
      }
    }
    return result;
  }

  /** Preset max-model-len options (raw token values, no parallel-slots multiplier). */
  readonly maxLenPresets = computed<{ label: string }[]>(() =>
    CONTEXT_PRESETS.map((p) => ({ label: formatContextSize(p, 1) })),
  );

  /** Normalize free-form maxModelLen input on blur / Enter (parse → re-format for consistent display). */
  onMaxLenInput(): void {
    const parsed = parseContextSize((this.form.get("maxModelLen")?.value as string) ?? "");
    this.form.get("maxModelLen")?.setValue(formatContextSize(parsed, 1), { emitEvent: false });
  }

  /** Check whether a form control value differs from its compiled default. */
  isControlChanged(controlName: string): boolean {
    const val = this.form.get(controlName)?.value;
    // maxModelLen is stored as formatted string; compare parsed number with default.
    if (controlName === "maxModelLen") {
      return +parseContextSize(val as string) !== DEFAULT_OPTIONS.maxModelLen;
    }
    return val !== undefined && val !== null && isChanged(controlName, val);
  }

  /** Check whether any of the given controls differs from default (for panel-level highlighting). */
  isSectionChanged(...controlNames: string[]): boolean {
    return controlNames.some((name) => this.isControlChanged(name));
  }

  // ── Conditional signals ──

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });

  readonly specMethodValue = computed(() => this.formValue()?.specMethod as string);

  /** Draft-model params only apply to draft-model speculative methods. */
  readonly showSpecDraftParams = computed(() => {
    const m = this.specMethodValue();
    return m !== "none" && m !== "ngram";
  });

  /** --enable-auto-tool-choice requires a tool-call parser to make sense. */
  readonly isToolCallParserDisabled = computed(() => !this.formValue()?.enableAutoToolChoice);

  ngOnInit(): void {
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
    const flags = cfg.flags;

    // Model: first non-"--" flag line is `serve <model>`.
    const model = findFlag(flags, "serve") ?? "";
    f.model.setValue(model);

    // Identity
    f.host.setValue(flagStr(flags, "--host", DEFAULT_OPTIONS.host));
    f.port.setValue(flagNum(flags, "--port", DEFAULT_OPTIONS.port));
    // servedModelName holds all served names, comma-separated (first = primary, rest = aliases).
    f.servedModelName.setValue(findAllFlags(flags, "--served-model-name").join(", "));

    // Model
    f.tokenizer.setValue(flagStr(flags, "--tokenizer", ""));
    f.dtype.setValue(flagStr(flags, "--dtype", DEFAULT_OPTIONS.dtype));

    // Parallelism & Memory
    f.tensorParallelSize.setValue(flagNum(flags, "--tensor-parallel-size", DEFAULT_OPTIONS.tensorParallelSize));
    f.pipelineParallelSize.setValue(flagNum(flags, "--pipeline-parallel-size", DEFAULT_OPTIONS.pipelineParallelSize));
    f.maxParallelLoadingWorkers.setValue(
      flagNum(flags, "--max-parallel-loading-workers", DEFAULT_OPTIONS.maxParallelLoadingWorkers),
    );
    f.gpuMemoryUtilization.setValue(flagFloat(flags, "--gpu-memory-utilization", DEFAULT_OPTIONS.gpuMemoryUtilization));
    f.swapSpace.setValue(flagFloat(flags, "--swap-space", DEFAULT_OPTIONS.swapSpace));
    f.cpuOffloadGb.setValue(flagFloat(flags, "--cpu-offload-gb", DEFAULT_OPTIONS.cpuOffloadGb));
    f.kvCacheMemory.setValue(flagNum(flags, "--kv-cache-memory-bytes", DEFAULT_OPTIONS.kvCacheMemory));
    f.device.setValue(flagStr(flags, "--device", ""));
    f.attentionBackend.setValue(flagStr(flags, "--attention-backend", DEFAULT_OPTIONS.attentionBackend));

    // Context & Scheduling
    f.maxModelLen.setValue(formatContextSize(flagNum(flags, "--max-model-len", DEFAULT_OPTIONS.maxModelLen), 1));
    f.maxNumSeqs.setValue(flagNum(flags, "--max-num-seqs", DEFAULT_OPTIONS.maxNumSeqs));
    f.maxNumBatchedTokens.setValue(flagNum(flags, "--max-num-batched-tokens", DEFAULT_OPTIONS.maxNumBatchedTokens));
    f.blockSize.setValue(flagNum(flags, "--block-size", DEFAULT_OPTIONS.blockSize));
    f.enableChunkedPrefill.setValue(
      flagTri(flags, "--enable-chunked-prefill", "--no-enable-chunked-prefill", DEFAULT_OPTIONS.enableChunkedPrefill),
    );

    // Speculative decoding
    f.specMethod.setValue(flagStr(flags, "--spec-method", DEFAULT_OPTIONS.specMethod));
    f.specTokens.setValue(flagNum(flags, "--spec-tokens", DEFAULT_OPTIONS.specTokens));
    f.specDraftModel.setValue(flagStr(flags, "--spec-draft-model", ""));
    f.specDraftTensorParallelSize.setValue(
      flagNum(flags, "--spec-draft-tensor-parallel-size", DEFAULT_OPTIONS.specDraftTensorParallelSize),
    );
    f.specNumDraftTokens.setValue(flagNum(flags, "--num-spec-tokens", DEFAULT_OPTIONS.specNumDraftTokens));

    // Sampling defaults
    f.temperature.setValue(flagFloat(flags, "--temperature", DEFAULT_OPTIONS.temperature));
    f.topP.setValue(flagFloat(flags, "--top-p", DEFAULT_OPTIONS.topP));
    f.topK.setValue(flagNum(flags, "--top-k", DEFAULT_OPTIONS.topK));
    f.minP.setValue(flagFloat(flags, "--min-p", DEFAULT_OPTIONS.minP));
    f.seed.setValue(flagNum(flags, "--seed", DEFAULT_OPTIONS.seed));
    f.repetitionPenalty.setValue(flagFloat(flags, "--repetition-penalty", DEFAULT_OPTIONS.repetitionPenalty));
    f.maxNumSeq.setValue(flagNum(flags, "--max-num-seq", DEFAULT_OPTIONS.maxNumSeq));

    // Tools & chat
    f.trustRemoteCode.setValue(flags.some((e) => e.split(/\s|=/)[0] === "--trust-remote-code"));
    f.enableAutoToolChoice.setValue(flags.some((e) => e.split(/\s|=/)[0] === "--enable-auto-tool-choice"));
    f.toolCallParser.setValue(flagStr(flags, "--tool-call-parser", ""));
    f.reasoningParser.setValue(flagStr(flags, "--reasoning-parser", ""));
    f.enablePrefixCaching.setValue(flagStr(flags, "--enable-prefix-caching", DEFAULT_OPTIONS.enablePrefixCaching));

    // Server
    f.apiKey.setValue(flagStr(flags, "--api-key", ""));

    // Extra flags: any "--"-prefixed flag line not covered by structured fields.
    f.extraFlags.setValue(this.extractExtraFlags(flags).join("\n"));

    // Environment
    if (cfg.environment) {
      const envLines = Object.entries(cfg.environment)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      if (envLines) {
        f.envText.setValue(envLines + "\n");
      }
    }
  }

  /** Flag lines not covered by structured fields (kept verbatim, one per line). */
  private extractExtraFlags(flags: string[]): string[] {
    const known = new Set<string>([
      "--host",
      "--port",
      "--served-model-name",
      "--tokenizer",
      "--dtype",
      "--tensor-parallel-size",
      "--pipeline-parallel-size",
      "--max-parallel-loading-workers",
      "--gpu-memory-utilization",
      "--swap-space",
      "--cpu-offload-gb",
      "--kv-cache-memory-bytes",
      "--device",
      "--attention-backend",
      "--max-model-len",
      "--max-num-seqs",
      "--max-num-batched-tokens",
      "--block-size",
      "--enable-chunked-prefill",
      "--no-enable-chunked-prefill",
      "--spec-method",
      "--spec-tokens",
      "--spec-draft-model",
      "--spec-draft-tensor-parallel-size",
      "--num-spec-tokens",
      "--temperature",
      "--top-p",
      "--top-k",
      "--min-p",
      "--seed",
      "--repetition-penalty",
      "--max-num-seq",
      "--trust-remote-code",
      "--enable-auto-tool-choice",
      "--tool-call-parser",
      "--reasoning-parser",
      "--enable-prefix-caching",
      "--api-key",
    ]);
    const result: string[] = [];
    for (const entry of flags) {
      const key = entry.split(/\s|=/)[0];
      if (entry.startsWith("--") && !known.has(key)) {
        result.push(entry);
      }
    }
    return result;
  }

  /** Add flag only if value differs from default. Compares as strings for uniformity. */
  private addIf(flags: string[], flag: string, value: unknown, defaultVal: string | number): void {
    if (String(value) !== String(defaultVal)) {
      flags.push(`${flag} ${value}`);
    }
  }

  /** Tri-state toggle: "on" → positive flag, "off" → --no-* flag, "auto" → nothing. */
  private addTri(flags: string[], value: string, positive: string): void {
    if (value === "on") flags.push(positive);
    else if (value === "off") flags.push(`--no-${positive.slice(2)}`);
  }

  buildFlags(): string[] {
    const flags: string[] = [];
    const c = this.form.controls;

    const model = (c.model.value ?? "").trim();
    if (model) flags.push(`serve ${model}`);

    // Flag order mirrors the user's vllm configs: serve → served-model-name →
    // host/port → parallelism → context → speculative → gpu-memory-utilization →
    // tools → sampling → server → extras.
    // One --served-model-name per comma-separated name (primary + aliases).
    for (const name of (c.servedModelName.value ?? "").split(",")) {
      const trimmedName = name.trim();
      if (trimmedName) flags.push(`--served-model-name ${trimmedName}`);
    }
    this.addIf(flags, "--host", c.host.value, DEFAULT_OPTIONS.host);
    this.addIf(flags, "--port", c.port.value, DEFAULT_OPTIONS.port);

    // Model
    this.addIf(flags, "--tokenizer", (c.tokenizer.value ?? "").trim(), DEFAULT_OPTIONS.tokenizer);
    this.addIf(flags, "--dtype", c.dtype.value, DEFAULT_OPTIONS.dtype);

    // Parallelism
    this.addIf(flags, "--tensor-parallel-size", c.tensorParallelSize.value, DEFAULT_OPTIONS.tensorParallelSize);
    this.addIf(flags, "--pipeline-parallel-size", c.pipelineParallelSize.value, DEFAULT_OPTIONS.pipelineParallelSize);
    this.addIf(
      flags,
      "--max-parallel-loading-workers",
      c.maxParallelLoadingWorkers.value,
      DEFAULT_OPTIONS.maxParallelLoadingWorkers,
    );
    this.addIf(flags, "--swap-space", c.swapSpace.value, DEFAULT_OPTIONS.swapSpace);
    this.addIf(flags, "--cpu-offload-gb", c.cpuOffloadGb.value, DEFAULT_OPTIONS.cpuOffloadGb);
    this.addIf(flags, "--device", (c.device.value ?? "").trim(), DEFAULT_OPTIONS.device);

    // Context & Scheduling
    this.addIf(flags, "--max-model-len", +parseContextSize(c.maxModelLen.value ?? ""), DEFAULT_OPTIONS.maxModelLen);
    this.addIf(flags, "--max-num-seqs", c.maxNumSeqs.value, DEFAULT_OPTIONS.maxNumSeqs);
    this.addIf(flags, "--block-size", c.blockSize.value, DEFAULT_OPTIONS.blockSize);

    // Speculative decoding
    const specMethod = c.specMethod.value as string;
    if (specMethod && specMethod !== DEFAULT_OPTIONS.specMethod) {
      flags.push(`--spec-method ${specMethod}`);
      this.addIf(flags, "--spec-tokens", c.specTokens.value, DEFAULT_OPTIONS.specTokens);
      if (this.showSpecDraftParams()) {
        this.addIf(flags, "--spec-draft-model", (c.specDraftModel.value ?? "").trim(), DEFAULT_OPTIONS.specDraftModel);
        this.addIf(
          flags,
          "--spec-draft-tensor-parallel-size",
          c.specDraftTensorParallelSize.value,
          DEFAULT_OPTIONS.specDraftTensorParallelSize,
        );
        this.addIf(flags, "--num-spec-tokens", c.specNumDraftTokens.value, DEFAULT_OPTIONS.specNumDraftTokens);
      }
    }

    this.addIf(flags, "--gpu-memory-utilization", c.gpuMemoryUtilization.value, DEFAULT_OPTIONS.gpuMemoryUtilization);

    // Tools & chat
    if (c.trustRemoteCode.value) flags.push("--trust-remote-code");
    if (c.enableAutoToolChoice.value) flags.push("--enable-auto-tool-choice");
    this.addIf(flags, "--tool-call-parser", c.toolCallParser.value, DEFAULT_OPTIONS.toolCallParser);
    this.addIf(flags, "--reasoning-parser", c.reasoningParser.value, DEFAULT_OPTIONS.reasoningParser);
    this.addTri(flags, c.enableChunkedPrefill.value as string, "--enable-chunked-prefill");
    this.addIf(flags, "--attention-backend", c.attentionBackend.value, DEFAULT_OPTIONS.attentionBackend);
    // Emitted after --attention-backend to match the user's vllm config layout (no diff noise on re-save).
    this.addIf(flags, "--max-num-batched-tokens", c.maxNumBatchedTokens.value, DEFAULT_OPTIONS.maxNumBatchedTokens);
    if (String(c.kvCacheMemory.value) !== String(DEFAULT_OPTIONS.kvCacheMemory)) {
      flags.push(`--kv-cache-memory-bytes=${c.kvCacheMemory.value}`);
    }

    // Sampling defaults
    this.addIf(flags, "--temperature", c.temperature.value, DEFAULT_OPTIONS.temperature);
    this.addIf(flags, "--top-p", c.topP.value, DEFAULT_OPTIONS.topP);
    this.addIf(flags, "--top-k", c.topK.value, DEFAULT_OPTIONS.topK);
    this.addIf(flags, "--min-p", c.minP.value, DEFAULT_OPTIONS.minP);
    this.addIf(flags, "--seed", c.seed.value, DEFAULT_OPTIONS.seed);
    this.addIf(flags, "--repetition-penalty", c.repetitionPenalty.value, DEFAULT_OPTIONS.repetitionPenalty);
    this.addIf(flags, "--max-num-seq", c.maxNumSeq.value, DEFAULT_OPTIONS.maxNumSeq);
    this.addIf(flags, "--enable-prefix-caching", c.enablePrefixCaching.value, DEFAULT_OPTIONS.enablePrefixCaching);

    // Server
    this.addIf(flags, "--api-key", (c.apiKey.value ?? "").trim(), DEFAULT_OPTIONS.apiKey);

    // Extra flags (free-form, one per line)
    for (const line of (c.extraFlags.value as string).split("\n")) {
      const trimmed = line.trim();
      if (trimmed && trimmed.startsWith("--")) {
        flags.push(trimmed);
      }
    }

    return flags;
  }

  parseEnvironment(): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const line of (this.form.controls.envText.value as string).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      environment[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1);
    }
    return environment;
  }

  save(): void {
    if (this.form.invalid) return;

    const environment = this.parseEnvironment();
    const cfg: ServiceConfig = {
      name: this.form.controls.name.value!.trim(),
      type: "vllm" as ServiceType,
      command: this.form.controls.command.value!.trim(),
      flags: this.buildFlags(),
      ...(Object.keys(environment).length ? { environment } : {}),
    };

    this.dialogRef.close(cfg);
  }

  cancel(): void {
    this.dialogRef.close();
  }
}

/** Value of a flag line ("--flag value" / "--flag=value" / separate tokens). */
function flagStr(flags: string[], name: string, fallback: string): string {
  const val = findFlag(flags, name);
  return val !== null ? val : fallback;
}

function flagNum(flags: string[], name: string, fallback: number): number {
  const val = findFlag(flags, name);
  if (val !== null) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function flagFloat(flags: string[], name: string, fallback: number): number {
  const val = findFlag(flags, name);
  if (val !== null) {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/** Tri-state flag: standalone positive → "on", negative → "off", "--flag <bool>" → parsed value, else fallback. */
function flagTri(flags: string[], positive: string, negative: string, fallback: string): string {
  let seen: string | null = null;
  for (const entry of flags) {
    const [key, ...rest] = entry.split(/\s+/);
    if (key === positive) {
      const arg = rest.join(" ").trim();
      if (arg === "false") seen = "off";
      else seen = "on";
    } else if (key === negative) {
      seen = "off";
    }
  }
  return seen ?? fallback;
}
