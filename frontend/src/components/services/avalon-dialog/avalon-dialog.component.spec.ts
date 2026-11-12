import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal, WritableSignal } from "@angular/core";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { of } from "rxjs";
import { AvalonDialogComponent, AvalonDialogData } from "./avalon-dialog.component";
import { ServiceConfig } from "../../../models/service";
import { ServiceService } from "../../../services/service.service";
import { SystemService } from "../../../services/system.service";
import { GpuService } from "../../../services/gpu.service";
import { Gpu } from "../../../models/gpu";

const RUN_SH = "/home/yar/MyDocs/AiChat/avalon/run.sh";
const MODEL =
  "/home/yar/.cache/huggingface/hub/models--huihui-ai--Huihui-Qwen3.8-Flash-Next-abliterated-v2-GGUF/snapshots/411f1f7349c9711e6f75aa8d20e1612eb3a4d55d/unsloth-UD-Q4_K_XL-V2/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf";
const MMPROJ =
  "/home/yar/.cache/huggingface/hub/models--huihui-ai--Huihui-Qwen3.8-Flash-Next-abliterated-v2-GGUF/snapshots/411f1f7349c9711e6f75aa8d20e1612eb3a4d55d/mmproj-Qwen3.8-Flash-Next-BF16.gguf";
const DRAFT =
  "/home/yar/.cache/huggingface/hub/models--freriadoc--Qwen3.8-Flash-Next-Avalon-GGUF/snapshots/372fe3a4e572c5ba75a90e579de0695633d083a8/MTP/mtp-Qwen3.8-Flash-Next-shared-IQ3K-IQ4NL-FR65k.gguf";
const BIN = "/home/yar/MyDocs/AiChat/avalon/repo/build/bin/llama-server";

/** Mirrors ~/.config/aiservermanager/services/avalon-qwen3_8_fn_abliterated-q4-2gpu-256k.conf. */
const AVALON_CONFIG: ServiceConfig = {
  name: "avalon-qwen3_8_fn_abliterated-q4-2gpu-256k",
  type: "avalon",
  command: RUN_SH,
  flags: [],
  environment: { MODEL, MMPROJ, GPUS: "ROCm0", MMDEV: "ROCm1" },
  user: "yar",
};

/** Everything set to a non-default value, EXTRA included. */
const AVALON_FULL_CONFIG: ServiceConfig = {
  name: "avalon-qwen3_8_fn-q4-2gpu-256k",
  type: "avalon",
  command: RUN_SH,
  flags: [],
  environment: {
    BIN,
    MODEL,
    DRAFT,
    MMPROJ,
    GPUS: "ROCm0,ROCm1",
    MMDEV: "cpu",
    HOST: "127.0.0.1",
    PORT: "4245",
    CTX: "131072",
    EXTRA: "--parallel 4",
    GGML_CUDA_MOE_CACHE_PRELOAD: "/home/yar/MyDocs/AiChat/avalon/moe-cache-ranking.bin",
  },
};

/** AMD + NVIDIA host for the device-name suggestions. */
const GPUS: Gpu[] = [
  { index: 0, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 0, vramTotal: 24, pciBusId: "03:00.0" },
  { index: 1, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 1, vramTotal: 24, pciBusId: "04:00.0" },
  { index: 2, vendor: "NVIDIA", brand: "-", name: "RTX 4090", gpuIndex: 2, vramTotal: 24, pciBusId: "05:00.0" },
];

describe("AvalonDialogComponent", () => {
  let fixture: ComponentFixture<AvalonDialogComponent>;
  let component: AvalonDialogComponent;
  let dialogRef: { close: jest.Mock };
  let backendWindows: WritableSignal<boolean>;

  function create(
    config: ServiceConfig | null,
    allConfigs: ServiceConfig[] = [],
    clone = false,
    gpus: Gpu[] = GPUS,
    windows = false,
  ) {
    dialogRef = { close: jest.fn() };
    backendWindows = signal(false);
    const data: AvalonDialogData = { config, allConfigs, clone };
    TestBed.configureTestingModule({
      imports: [AvalonDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ServiceService, useValue: { getLlamaAutocomplete: jest.fn().mockReturnValue(of([])) } },
        { provide: GpuService, useValue: { fetchGpus: jest.fn().mockReturnValue(of(gpus)) } },
        {
          provide: SystemService,
          useValue: {
            windows: backendWindows.asReadonly(),
            detectWindows: jest.fn().mockImplementation(async () => {
              backendWindows.set(windows);
              return windows;
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AvalonDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function saved(): ServiceConfig {
    return dialogRef.close.mock.calls[0][0] as ServiceConfig;
  }

  /** Result of the most recent save — a test may save more than once. */
  function lastSaved(): ServiceConfig {
    const calls = dialogRef.close.mock.calls;
    return calls[calls.length - 1][0] as ServiceConfig;
  }

  it("requires a name and a command", () => {
    create(null);
    expect(component.form.valid).toBe(false);
    component.form.controls.name.setValue("avalon-test");
    component.form.controls.command.setValue(RUN_SH);
    expect(component.form.valid).toBe(true);
  });

  it("populates the fields an existing config sets and leaves the rest on launcher defaults", () => {
    create(AVALON_CONFIG);
    const f = component.form.controls;
    expect(f.name.value).toBe("avalon-qwen3_8_fn_abliterated-q4-2gpu-256k");
    expect(f.command.value).toBe(RUN_SH);
    expect(f.model.value).toBe(MODEL);
    expect(f.mmproj.value).toBe(MMPROJ);
    expect(f.gpus.value).toBe("ROCm0");
    expect(f.mmdev.value).toBe("ROCm1");
    expect(f.host.value).toBe("0.0.0.0");
    expect(f.port.value).toBe(4239);
    expect(f.ctxSize.value).toBe("256K");
    expect(f.parallel.value).toBe(1);
    expect(f.envText.value).toBe("");
    expect(f.user.value).toBe("yar");
  });

  it("writes an env-driven config: type=avalon, no flags, values as environment", () => {
    create(AVALON_FULL_CONFIG);
    component.save();
    expect(saved().type).toBe("avalon");
    expect(saved().command).toBe(RUN_SH);
    expect(saved().flags).toEqual([]);
    expect(saved().environment).toEqual(AVALON_FULL_CONFIG.environment);
  });

  it("round-trips a fully-populated config through save() unchanged", () => {
    create(AVALON_FULL_CONFIG);
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining(AVALON_FULL_CONFIG));
  });

  it("omits values equal to the launcher default (GPUS/MMDEV of the real config are not re-emitted)", () => {
    create(AVALON_CONFIG);
    component.save();
    expect(saved().environment).toEqual({ MODEL, MMPROJ });
    expect(saved().user).toBe("yar");
  });

  it("emits nothing but the command for an untouched new service", () => {
    create(null);
    component.form.controls.name.setValue("avalon-new");
    component.form.controls.command.setValue(RUN_SH);
    component.save();
    expect(saved().flags).toEqual([]);
    expect(saved().environment).toBeUndefined();
  });

  it("reads --parallel out of EXTRA and writes it back", () => {
    create(AVALON_FULL_CONFIG);
    expect(component.form.controls.parallel.value).toBe(4);
    component.form.controls.parallel.setValue(8);
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--parallel 8");
  });

  it("accepts the --parallel=N spelling", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: "--parallel=3" } });
    expect(component.form.controls.parallel.value).toBe(3);
  });

  it("reads --no-reasoning-preserve out of EXTRA and writes it back next to --parallel", () => {
    create({
      name: "a",
      type: "avalon",
      command: RUN_SH,
      flags: [],
      environment: { EXTRA: "--parallel=3 --no-reasoning-preserve" },
    });
    expect(component.form.controls.parallel.value).toBe(3);
    expect(component.form.controls.reasoningPreserve.value).toBe("off");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--parallel 3 --no-reasoning-preserve");
  });

  it("emits EXTRA with only --no-reasoning-preserve when parallel stays at the default", () => {
    create(AVALON_CONFIG);
    expect(component.form.controls.reasoningPreserve.value).toBe("on");
    component.form.controls.reasoningPreserve.setValue("off");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--no-reasoning-preserve");
  });

  it("omits EXTRA when both parallel and reasoning preserve are at their defaults", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [] });
    component.form.controls.reasoningPreserve.setValue("off");
    component.form.controls.reasoningPreserve.setValue("on");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBeUndefined();
    expect(component.isControlChanged("reasoningPreserve")).toBe(false);
  });

  it("omits EXTRA when the slot count is back to the launcher default of 1", () => {
    create(AVALON_FULL_CONFIG);
    component.form.controls.parallel.setValue(1);
    component.save();
    expect(saved().environment?.["EXTRA"]).toBeUndefined();
    expect(component.isControlChanged("parallel")).toBe(false);
  });

  it("round-trips the fit target and reasoning switch of the real config verbatim", () => {
    create({
      name: "a",
      type: "avalon",
      command: RUN_SH,
      flags: [],
      environment: { MMPROJ, MMDEV: "ROCm0", EXTRA: "--fit-target 1536 --no-reasoning-preserve" },
    });
    expect(component.form.controls.fitTarget.value).toBe("1536");
    expect(component.form.controls.reasoningPreserve.value).toBe("off");
    expect(component.form.controls.extraArgs.value).toBe("");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--fit-target 1536 --no-reasoning-preserve");
  });

  it("keeps EXTRA arguments the dialog has no field for instead of erasing them", () => {
    create({
      name: "a",
      type: "avalon",
      command: RUN_SH,
      flags: [],
      environment: { EXTRA: "-otd exps=ROCm0 --parallel 2 --spec-draft-n-max 4" },
    });
    expect(component.form.controls.parallel.value).toBe(2);
    expect(component.form.controls.extraArgs.value).toBe("-otd exps=ROCm0 --spec-draft-n-max 4");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--parallel 2 -otd exps=ROCm0 --spec-draft-n-max 4");
  });

  it("emits an edited fit target and the untouched rest of EXTRA together", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: "--fit-min-size 64" } });
    expect(component.form.controls.extraArgs.value).toBe("--fit-min-size 64");
    component.form.controls.fitTarget.setValue(2048);
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--fit-target 2048 --fit-min-size 64");
  });

  it("lets the structured fields win over the same argument typed in the free-form field", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: "--fit-target 1536" } });
    component.form.controls.extraArgs.setValue("--parallel 9 --fit-target 640 --no-reasoning-preserve --fit 1");
    component.form.controls.parallel.setValue(3);
    component.form.controls.fitTarget.setValue(1536);
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--fit-target 1536 --parallel 3 --fit 1");
  });

  it("omits the fit target and reports it unchanged while the field is empty", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: "--parallel 2" } });
    expect(component.form.controls.fitTarget.value).toBe("");
    expect(component.isControlChanged("fitTarget")).toBe(false);
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--parallel 2");
  });

  it("accepts the --fit-target=N spelling", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: "--fit-target=1536" } });
    expect(component.form.controls.fitTarget.value).toBe("1536");
    expect(component.form.controls.extraArgs.value).toBe("");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--fit-target 1536");
  });

  it("emits a single fit target when the stored EXTRA repeats the argument", () => {
    create({
      name: "a",
      type: "avalon",
      command: RUN_SH,
      flags: [],
      environment: { EXTRA: "--fit-target 1536 --fit-target 640" },
    });
    expect(component.form.controls.fitTarget.value).toBe("1536");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("--fit-target 1536");
  });

  it("carries an EXTRA that holds nothing but unowned arguments through the save untouched", () => {
    const extra = "-otd exps=ROCm0 --spec-draft-n-max 4";
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: extra } });
    expect(component.form.controls.extraArgs.value).toBe(extra);
    expect(component.isControlChanged("extraArgs")).toBe(true);
    expect(component.isSectionChanged("fitTarget", "extraArgs")).toBe(true);
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe(extra);
  });

  it("collapses newlines and repeated spaces typed into the free-form argument field", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { EXTRA: "--fit 1" } });
    // Replacing the field replaces the unowned part of EXTRA wholesale — the field is its source.
    component.form.controls.extraArgs.setValue("-otd  exps=ROCm0\n--fit-min-size 64\n");
    component.save();
    expect(saved().environment?.["EXTRA"]).toBe("-otd exps=ROCm0 --fit-min-size 64");
  });

  it("formats and re-parses the context size, emitting the raw token count", () => {
    create(AVALON_FULL_CONFIG);
    expect(component.form.controls.ctxSize.value).toBe("128K");
    component.form.controls.ctxSize.setValue("512K");
    component.save();
    expect(saved().environment?.["CTX"]).toBe("524288");
  });

  it("leaves CTX unset when the context field is cleared, instead of emitting 0", () => {
    create(AVALON_FULL_CONFIG);
    component.form.controls.ctxSize.setValue("");
    component.save();
    expect(lastSaved().environment?.["CTX"]).toBeUndefined();
  });

  it("keeps unmanaged variables in the textarea and ignores managed ones typed there", () => {
    create({
      name: "a",
      type: "avalon",
      command: RUN_SH,
      flags: [],
      environment: {
        MMPROJ,
        GGML_CUDA_MOE_CACHE_PRELOAD: "/home/yar/MyDocs/AiChat/avalon/moe-cache-ranking.bin",
      },
    });
    expect(component.form.controls.envText.value).toBe("GGML_CUDA_MOE_CACHE_PRELOAD=/home/yar/MyDocs/AiChat/avalon/moe-cache-ranking.bin\n");

    component.form.controls.envText.setValue("HF_TOKEN=hf_x\nGPUS=ROCm3\n");
    component.form.controls.gpus.setValue("ROCm2");
    component.save();
    expect(saved().environment).toMatchObject({ GPUS: "ROCm2", HF_TOKEN: "hf_x" });
    expect(component.parseEnvironment("GPUS=ROCm3\nHF_TOKEN=hf_x\n# note\nBAD\n")).toEqual({ HF_TOKEN: "hf_x" });
  });

  it("omits MMPROJ while vision is off and reports vision as off", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { MMPROJ: "none" } });
    expect(component.isVisionOn()).toBe(false);
    component.save();
    expect(saved().environment?.["MMPROJ"]).toBeUndefined();
  });

  it("warns when the vision card is one of the LLM cards", () => {
    create(AVALON_FULL_CONFIG);
    component.form.controls.mmproj.setValue(MMPROJ);
    component.form.controls.gpus.setValue("ROCm0,ROCm1");
    component.form.controls.mmdev.setValue("ROCm1");
    expect(component.isVisionDeviceClash()).toBe(true);

    component.form.controls.mmdev.setValue("ROCm2");
    expect(component.isVisionDeviceClash()).toBe(false);
  });

  it("accepts a vision card shared with the LLM once the fit target leaves room for the projector", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { MMPROJ, GPUS: "ROCm0", MMDEV: "ROCm0", EXTRA: "--fit-target 1536" } });
    expect(component.isVisionDeviceClash()).toBe(false);

    component.form.controls.fitTarget.setValue(1024);
    expect(component.isVisionDeviceClash()).toBe(true);
  });

  it("treats exactly 1280 MiB of fit target as enough room and 1 MiB less as not", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { MMPROJ, GPUS: "ROCm0", MMDEV: "ROCm0" } });
    component.form.controls.fitTarget.setValue("1280");
    expect(component.isVisionDeviceClash()).toBe(false);

    component.form.controls.fitTarget.setValue("1279");
    expect(component.isVisionDeviceClash()).toBe(true);
  });

  it("warns for a cleared fit target on a shared vision card, the launcher default being 400", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { MMPROJ, GPUS: "ROCm0", MMDEV: "ROCm0", EXTRA: "--fit-target 1536" } });
    expect(component.isVisionDeviceClash()).toBe(false);

    component.form.controls.fitTarget.setValue(null);
    expect(component.isVisionDeviceClash()).toBe(true);
  });

  it("matches the vision card against every card of a multi-GPU list", () => {
    create({
      name: "a",
      type: "avalon",
      command: RUN_SH,
      flags: [],
      environment: { MMPROJ, GPUS: "ROCm0,ROCm1", MMDEV: "ROCm1", EXTRA: "--fit-target 1536" },
    });
    expect(component.isVisionDeviceClash()).toBe(false);

    component.form.controls.fitTarget.setValue("");
    expect(component.isVisionDeviceClash()).toBe(true);
  });

  it("does not warn about a vision card clash while the ViT is off the GPU or vision is off", () => {
    create(AVALON_FULL_CONFIG);
    component.form.controls.mmproj.setValue(MMPROJ);
    component.form.controls.gpus.setValue("ROCm0");
    component.form.controls.mmdev.setValue("cpu");
    expect(component.isVisionDeviceClash()).toBe(false);

    component.form.controls.mmdev.setValue("ROCm0");
    component.form.controls.mmproj.setValue("none");
    expect(component.isVisionDeviceClash()).toBe(false);
  });

  it("suggests llama-style device names from the GPU list, never running the launcher", () => {
    create(null);
    expect(component.deviceNames()).toEqual(["ROCm0", "ROCm1", "CUDA2"]);
    expect(component.mmdevSuggestions()).toEqual(["ROCm0", "ROCm1", "CUDA2", "none", "cpu"]);
  });

  it("offers paths other avalon configs already use", () => {
    create(null, [AVALON_FULL_CONFIG]);
    expect(component.existingModelPaths()).toEqual([MODEL]);
    expect(component.existingMmprojPaths()).toEqual([MMPROJ]);
  });

  it("carries BIN and DRAFT through the environment textarea, which now owns them", () => {
    create(AVALON_FULL_CONFIG);
    expect(component.form.controls.envText.value).toContain(`BIN=${BIN}`);
    expect(component.form.controls.envText.value).toContain(`DRAFT=${DRAFT}`);
    component.save();
    expect(lastSaved().environment).toMatchObject({ BIN, DRAFT });
  });

  it("keeps launcher arguments verbatim so a save cannot lose them", () => {
    const config: ServiceConfig = { name: "a", type: "avalon", command: RUN_SH, flags: ["--dry-run", "--verbose"] };
    create(config);
    expect(component.form.controls.extraFlags.value).toBe("--dry-run\n--verbose");
    component.save();
    expect(saved().flags).toEqual(["--dry-run", "--verbose"]);
  });

  it("preserves workingDirectory and stopCommand, which have no field here", () => {
    create({ ...AVALON_CONFIG, workingDirectory: "/home/yar/MyDocs/AiChat/avalon", stopCommand: "/bin/true" });
    component.save();
    expect(saved().workingDirectory).toBe("/home/yar/MyDocs/AiChat/avalon");
    expect(saved().stopCommand).toBe("/bin/true");
  });

  it("prefills and saves run-as + restart policy, omitting the empty ones", () => {
    create({ ...AVALON_CONFIG, user: "yar", group: "ai", restart: "always" });
    expect(component.form.controls.group.value).toBe("ai");
    expect(component.form.controls.restart.value).toBe("always");
    component.save();
    expect(saved().user).toBe("yar");
    expect(saved().group).toBe("ai");
    expect(saved().restart).toBe("always");

    component.form.controls.user.setValue("");
    component.form.controls.group.setValue("");
    component.form.controls.restart.setValue("no");
    component.save();
    expect(lastSaved().user).toBeUndefined();
    expect(lastSaved().group).toBeUndefined();
    expect(lastSaved().restart).toBeUndefined();
  });

  it("locks the group field and says LocalSystem on a Windows backend", async () => {
    create({ ...AVALON_CONFIG, user: "yar", group: "ai" }, [], false, GPUS, true);
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → LocalSystem");
    expect(component.runAs.groupHint()).toBe("not used on Windows");
    expect(component.form.controls.group.disabled).toBe(true);
  });

  it("keeps the group field editable on a Linux backend", async () => {
    create({ ...AVALON_CONFIG, user: "yar", group: "ai" });
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → root");
    expect(component.form.controls.group.disabled).toBe(false);
  });

  it("renders the fit-target input and the free-form argument field, wired to their controls", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { MMPROJ, EXTRA: "--fit-target 1536 -otd exps=ROCm0" } });
    const el = fixture.nativeElement as HTMLElement;

    const fitInput = el.querySelector('input[formcontrolname="fitTarget"]') as HTMLInputElement;
    const extraArea = el.querySelector('textarea[formcontrolname="extraArgs"]') as HTMLTextAreaElement;
    expect(fitInput).not.toBeNull();
    expect(extraArea).not.toBeNull();

    component.form.controls.fitTarget.setValue(2048);
    component.form.controls.extraArgs.setValue("--fit-min-size 64");
    fixture.detectChanges();
    expect(fitInput.value).toBe("2048");
    expect(extraArea.value).toBe("--fit-min-size 64");
  });

  it("hides the shared-card warning once the fit target leaves room, and shows it again below the threshold", () => {
    create({ name: "a", type: "avalon", command: RUN_SH, flags: [], environment: { MMPROJ, GPUS: "ROCm0", MMDEV: "ROCm0" } });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector(".hint-warning")).not.toBeNull();
    expect(el.querySelector(".hint-warning")?.textContent).toContain("1280");

    component.form.controls.fitTarget.setValue(1536);
    fixture.detectChanges();
    expect(el.querySelector(".hint-warning")).toBeNull();

    component.form.controls.fitTarget.setValue(640);
    fixture.detectChanges();
    expect(el.querySelector(".hint-warning")).not.toBeNull();
  });

  it("marks changed fields against the launcher defaults", () => {
    create(AVALON_CONFIG);
    expect(component.isControlChanged("model")).toBe(true);
    expect(component.isControlChanged("gpus")).toBe(false);
    expect(component.isControlChanged("mmdev")).toBe(false);
    expect(component.isControlChanged("ctxSize")).toBe(false);
    expect(component.isSectionChanged("model")).toBe(true);
    expect(component.isSectionChanged("host", "port", "ctxSize")).toBe(false);
  });

  it("renames the service and refuses a name another config already holds", () => {
    create(AVALON_CONFIG, [AVALON_CONFIG, { name: "vllm-qwen", type: "vllm", command: "/bin/vllm", flags: [] }]);
    const name = component.form.controls.name;

    expect(name.disabled).toBe(false);
    expect(name.valid).toBe(true); // its own name stays valid

    name.setValue("avalon-renamed");
    expect(name.valid).toBe(true);
    component.save();
    expect(lastSaved().name).toBe("avalon-renamed");

    name.setValue("vllm-qwen");
    expect(name.hasError("nameTaken")).toBe(true);
    expect(component.form.valid).toBe(false);
  });

  it("cancel closes the dialog without a result", () => {
    create(null);
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
