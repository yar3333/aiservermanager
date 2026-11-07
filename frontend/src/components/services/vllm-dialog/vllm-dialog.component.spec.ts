import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal, WritableSignal } from "@angular/core";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { of } from "rxjs";
import { VllmDialogComponent, VllmDialogData } from "./vllm-dialog.component";
import { ServiceConfig } from "../../../models/service";
import { ServiceService } from "../../../services/service.service";
import { SystemService } from "../../../services/system.service";
import { GpuService } from "../../../services/gpu.service";
import { Gpu } from "../../../models/gpu";

/** Mirrors ~/.config/aiservermanager/services/vllm-qwen-fp8-4gpu.conf */
const VLLM_CONFIG: ServiceConfig = {
  name: "vllm-qwen-fp8-4gpu",
  type: "vllm",
  command: "/home/yar/MyDocs/AiChat/vllm/run.sh",
  flags: [
    "serve Qwen/Qwen3.8-Flash-Next-FP8",
    "--served-model-name qwen-256k",
    "--host 0.0.0.0",
    "--port 4239",
    "--tensor-parallel-size 4",
    "--max-model-len 262144",
    "--max-num-seqs 8",
    "--spec-method qwen3_5_mtp",
    "--spec-tokens 3",
    "--gpu-memory-utilization 0.95",
    "--trust-remote-code",
    "--enable-auto-tool-choice",
    "--tool-call-parser qwen3_xml",
    "--reasoning-parser qwen3",
    "--enable-chunked-prefill",
    "--attention-backend TRITON_ATTN",
  ],
  environment: { HF_TOKEN: "hf_test" },
};

/** Mirrors ~/.config/aiservermanager/services/vllm-qwen-bf16-4gpu.conf */
const VLLM_BF16_CONFIG: ServiceConfig = {
  name: "vllm-qwen-bf16-4gpu",
  type: "vllm",
  command: "/home/yar/MyDocs/AiChat/vllm/run.sh",
  flags: [
    "serve unsloth/Qwen3.8-27B",
    "--served-model-name qwen-256k",
    "--host 0.0.0.0",
    "--port 4239",
    "--tensor-parallel-size 4",
    "--max-model-len 262144",
    "--max-num-seqs 8",
    "--spec-method mtp",
    "--spec-tokens 3",
    "--gpu-memory-utilization 0.95",
    "--trust-remote-code",
    "--enable-auto-tool-choice",
    "--tool-call-parser qwen3_xml",
    "--reasoning-parser qwen3",
    "--enable-chunked-prefill",
    "--attention-backend ROCM_SEGMENTED_ATTN",
    "--max-num-batched-tokens 8192",
    "--kv-cache-memory-bytes=5393671680",
  ],
  environment: { HF_TOKEN: "hf_test", FLASH_ATTENTION_TRITON_AMD_ENABLE: "TRUE" },
};

/** Mixed AMD + NVIDIA host used by the GPU multi-select tests. */
const GPUS: Gpu[] = [
  { index: 0, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 0, vramTotal: 24, pciBusId: "03:00.0" },
  { index: 1, vendor: "NVIDIA", brand: "-", name: "RTX 4090", gpuIndex: 1, vramTotal: 24, pciBusId: "04:00.0" },
];

describe("VllmDialogComponent", () => {
  let fixture: ComponentFixture<VllmDialogComponent>;
  let component: VllmDialogComponent;
  let dialogRef: { close: jest.Mock };
  let backendWindows: WritableSignal<boolean>;

  function create(
    config: ServiceConfig | null,
    allConfigs: ServiceConfig[] = [],
    clone = false,
    gpus: Gpu[] = [],
    windows = false,
  ) {
    dialogRef = { close: jest.fn() };
    backendWindows = signal(false);
    const data: VllmDialogData = { config, allConfigs, clone };
    TestBed.configureTestingModule({
      imports: [VllmDialogComponent],
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
    fixture = TestBed.createComponent(VllmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it("requires a name and command", () => {
    create(null);
    expect(component.form.valid).toBe(false);
    component.form.controls.name.setValue("vllm-test");
    component.form.controls.command.setValue("/bin/vllm");
    expect(component.form.valid).toBe(true);
  });

  it("populates structured fields from an existing config", () => {
    create(VLLM_CONFIG);
    const f = component.form.controls;
    expect(f.name.value).toBe("vllm-qwen-fp8-4gpu");
    expect(f.command.value).toBe("/home/yar/MyDocs/AiChat/vllm/run.sh");
    expect(f.model.value).toBe("Qwen/Qwen3.8-Flash-Next-FP8");
    expect(f.servedModelName.value).toBe("qwen-256k");
    expect(f.host.value).toBe("0.0.0.0");
    expect(f.port.value).toBe(4239);
    expect(f.tensorParallelSize.value).toBe(4);
    expect(f.maxModelLen.value).toBe("256K");
    expect(f.maxNumSeqs.value).toBe(8);
    expect(f.specMethod.value).toBe("qwen3_5_mtp");
    expect(f.specTokens.value).toBe(3);
    expect(f.gpuMemoryUtilization.value).toBe(0.95);
    expect(f.trustRemoteCode.value).toBe(true);
    expect(f.enableAutoToolChoice.value).toBe(true);
    expect(f.toolCallParser.value).toBe("qwen3_xml");
    expect(f.reasoningParser.value).toBe("qwen3");
    expect(f.enableChunkedPrefill.value).toBe("on");
    expect(f.attentionBackend.value).toBe("TRITON_ATTN");
    expect(f.envText.value).toBe("HF_TOKEN=hf_test\n");
  });

  it("round-trips a config through save() unchanged", () => {
    create(VLLM_CONFIG);
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining(VLLM_CONFIG));
  });

  it("populates the bf16 config (mtp spec, ROCM_SEGMENTED_ATTN, kv-cache-memory-bytes)", () => {
    create(VLLM_BF16_CONFIG);
    const f = component.form.controls;
    expect(f.specMethod.value).toBe("mtp");
    expect(f.attentionBackend.value).toBe("ROCM_SEGMENTED_ATTN");
    expect(f.maxNumBatchedTokens.value).toBe(8192);
    expect(f.kvCacheMemory.value).toBe(5393671680);
    expect(f.extraFlags.value).toBe("");
  });

  it("round-trips the bf16 config through save() unchanged", () => {
    create(VLLM_BF16_CONFIG);
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining(VLLM_BF16_CONFIG));
  });

  it("populates the GPU multi-select from HIP_VISIBLE_DEVICES and keeps it out of the env textarea", () => {
    create({
      name: "vllm-dev",
      type: "vllm",
      command: "/bin/vllm",
      flags: ["serve test/model"],
      environment: { HF_TOKEN: "hf_x", HIP_VISIBLE_DEVICES: "0,1,2,3" },
    });
    expect(component.form.controls.deviceIds.value).toEqual([0, 1, 2, 3]);
    expect(component.form.controls.envText.value).toBe("HF_TOKEN=hf_x\n");
    expect(component.isControlChanged("deviceIds")).toBe(true);
  });

  it("populates the GPU multi-select from CUDA_VISIBLE_DEVICES", () => {
    create({
      name: "vllm-dev",
      type: "vllm",
      command: "/bin/vllm",
      flags: ["serve test/model"],
      environment: { CUDA_VISIBLE_DEVICES: "1" },
    });
    expect(component.form.controls.deviceIds.value).toEqual([1]);
    expect(component.form.controls.envText.value).toBe("");
  });

  it("prefers HIP_VISIBLE_DEVICES when both vars exist and keeps the CUDA one in the textarea", () => {
    create({
      name: "vllm-dev",
      type: "vllm",
      command: "/bin/vllm",
      flags: ["serve test/model"],
      environment: { CUDA_VISIBLE_DEVICES: "5", HIP_VISIBLE_DEVICES: "0,1" },
    });
    expect(component.form.controls.deviceIds.value).toEqual([0, 1]);
    expect(component.form.controls.envText.value).toBe("CUDA_VISIBLE_DEVICES=5\n");
  });

  it("writes HIP_VISIBLE_DEVICES into the environment when an AMD GPU is selected", () => {
    create(
      { name: "vllm-dev", type: "vllm", command: "/bin/vllm", flags: ["serve test/model"], environment: { HF_TOKEN: "hf_x" } },
      [],
      false,
      GPUS,
    );
    component.form.controls.deviceIds.setValue([0]);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toEqual({ HF_TOKEN: "hf_x", HIP_VISIBLE_DEVICES: "0" });
    expect(saved.flags).toEqual(["serve test/model"]);
  });

  it("writes CUDA_VISIBLE_DEVICES when only NVIDIA GPUs are selected", () => {
    create({ name: "vllm-dev", type: "vllm", command: "/bin/vllm", flags: ["serve test/model"] }, [], false, GPUS);
    component.form.controls.deviceIds.setValue([1]);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toEqual({ CUDA_VISIBLE_DEVICES: "1" });
  });

  it("round-trips a GPU selection through the editor unchanged", () => {
    create(
      {
        name: "vllm-dev",
        type: "vllm",
        command: "/bin/vllm",
        flags: ["serve test/model"],
        environment: { HF_TOKEN: "hf_x", HIP_VISIBLE_DEVICES: "0,2" },
      },
      [],
      false,
      GPUS,
    );
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toEqual({ HF_TOKEN: "hf_x", HIP_VISIBLE_DEVICES: "0,2" });
  });

  it("leaves env untouched when the picker is empty (manual *_VISIBLE_DEVICES preserved)", () => {
    create(null, [], false, GPUS);
    component.form.controls.name.setValue("vllm-dev");
    component.form.controls.command.setValue("/bin/vllm");
    component.form.controls.model.setValue("test/model");
    component.form.controls.envText.setValue("HIP_VISIBLE_DEVICES=0,1\n");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toEqual({ HIP_VISIBLE_DEVICES: "0,1" });
  });

  it("selection replaces a manual *_VISIBLE_DEVICES line from the env textarea", () => {
    create(null, [], false, GPUS);
    component.form.controls.name.setValue("vllm-dev");
    component.form.controls.command.setValue("/bin/vllm");
    component.form.controls.model.setValue("test/model");
    component.form.controls.envText.setValue("HF_TOKEN=x\nCUDA_VISIBLE_DEVICES=0,1\n");
    component.form.controls.deviceIds.setValue([0]);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toEqual({ HF_TOKEN: "x", HIP_VISIBLE_DEVICES: "0" });
  });

  it("keeps a legacy free-form --device value verbatim in extra flags", () => {
    create({ name: "vllm-dev", type: "vllm", command: "/bin/vllm", flags: ["serve test/model", "--device auto"] });
    expect(component.form.controls.deviceIds.value).toEqual([]);
    expect(component.form.controls.extraFlags.value).toBe("--device auto");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--device auto");
  });

  it("keeps a legacy --device-ids flag verbatim in extra flags", () => {
    create({ name: "vllm-dev", type: "vllm", command: "/bin/vllm", flags: ["serve test/model", "--device-ids 0,1"] });
    expect(component.form.controls.extraFlags.value).toBe("--device-ids 0,1");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--device-ids 0,1");
  });

  it("offers GPUs from GPU info as multi-select options", () => {
    create(null, [], false, GPUS);
    expect(component.availableGpus().map((g) => g.gpuIndex)).toEqual([0, 1]);
  });

  it("populates served model name(s) from repeated --served-model-name (comma-separated)", () => {
    create({
      name: "vllm-alias",
      type: "vllm",
      command: "/bin/vllm",
      flags: [
        "serve test/model",
        "--served-model-name qwen-256k",
        "--served-model-name qwen-256k-fast",
        "--served-model-name qwen",
        "--host 0.0.0.0",
      ],
    });
    expect(component.form.controls.servedModelName.value).toBe("qwen-256k, qwen-256k-fast, qwen");
  });

  it("keeps a single --served-model-name as-is", () => {
    create(VLLM_CONFIG);
    expect(component.form.controls.servedModelName.value).toBe("qwen-256k");
  });

  it("populates served model name(s) from a single --served-model-name with space-separated names", () => {
    create({
      name: "vllm-alias",
      type: "vllm",
      command: "/bin/vllm",
      flags: [
        "serve test/model",
        "--served-model-name qwen-256k qwen-256k-fast qwen",
        "--host 0.0.0.0",
      ],
    });
    expect(component.form.controls.servedModelName.value).toBe("qwen-256k, qwen-256k-fast, qwen");
  });

  it("round-trips a config with multiple served model names through save() unchanged", () => {
    const config: ServiceConfig = {
      name: "vllm-alias",
      type: "vllm",
      command: "/bin/vllm",
      flags: [
        "serve test/model",
        "--served-model-name qwen-256k qwen-256k-fast qwen",
        "--host 0.0.0.0",
        "--port 4239",
      ],
    };
    create(config);
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining(config));
  });

  it("normalizes legacy repeated --served-model-name flags into a single space-separated flag on save", () => {
    create({
      name: "vllm-alias",
      type: "vllm",
      command: "/bin/vllm",
      flags: [
        "serve test/model",
        "--served-model-name qwen-256k",
        "--served-model-name qwen-256k-fast",
        "--served-model-name qwen",
        "--host 0.0.0.0",
      ],
    });
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    const served = saved.flags.filter((x) => x.startsWith("--served-model-name"));
    expect(served).toEqual(["--served-model-name qwen-256k qwen-256k-fast qwen"]);
  });

  it("emits a single --served-model-name with space-separated entries and ignores empty entries", () => {
    create(null);
    const f = component.form.controls;
    f.name.setValue("vllm-new");
    f.command.setValue("/bin/vllm");
    f.model.setValue("test/model");
    f.servedModelName.setValue("qwen, qwen-fast, qwen2,  ");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--served-model-name qwen qwen-fast qwen2");
    expect(saved.flags.filter((x) => x.startsWith("--served-model-name")).length).toBe(1);
  });

  it("keeps unknown flags in extraFlags and emits them on save", () => {
    create({
      name: "vllm-x",
      type: "vllm",
      command: "/bin/vllm",
      flags: ["--enforce-eager", "--quantization gptq", "--unknown-flag foo"],
    });
    const f = component.form.controls;
    expect(f.extraFlags.value).toBe("--enforce-eager\n--quantization gptq\n--unknown-flag foo");
    f.name.setValue("vllm-x");
    f.command.setValue("/bin/vllm");
    f.model.setValue("test/model");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--enforce-eager");
    expect(saved.flags).toContain("--quantization gptq");
    expect(saved.flags).toContain("--unknown-flag foo");
  });

  it("omits defaults and empty values when building flags", () => {
    create(null);
    component.form.controls.name.setValue("vllm-min");
    component.form.controls.command.setValue("/bin/vllm");
    component.form.controls.model.setValue("test/model");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.type).toBe("vllm");
    expect(saved.flags).toEqual(["serve test/model"]);
    expect(saved.environment).toBeUndefined();
  });

  it("marks changed fields relative to defaults", () => {
    create(VLLM_CONFIG);
    expect(component.isControlChanged("port")).toBe(true);
    expect(component.isControlChanged("temperature")).toBe(false);
    expect(component.isSectionChanged("model", "tokenizer", "dtype")).toBe(true);
  });

  it("collects environment variables from the textarea", () => {
    create(null);
    component.form.controls.envText.setValue("# comment\nHF_TOKEN=hf_x\nBAD_LINE\n\n");
    expect(component.parseEnvironment()).toEqual({ HF_TOKEN: "hf_x" });
  });

  it("prefills and saves service unit run-as + restart fields", () => {
    create({ ...VLLM_CONFIG, user: "llama", group: "ai", restart: "always" });
    expect(component.form.controls.user.value).toBe("llama");
    expect(component.form.controls.group.value).toBe("ai");
    expect(component.form.controls.restart.value).toBe("always");

    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.user).toBe("llama");
    expect(saved.group).toBe("ai");
    expect(saved.restart).toBe("always");
  });

  it("locks the group field and says LocalSystem on a Windows backend", async () => {
    create({ ...VLLM_CONFIG, user: "vllm", group: "ai" }, [], false, [], true);
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → LocalSystem");
    expect(component.runAs.groupHint()).toBe("not used on Windows");
    expect(component.form.controls.group.disabled).toBe(true);
  });

  it("keeps the group field editable on a Linux backend", async () => {
    create({ ...VLLM_CONFIG, user: "vllm", group: "ai" });
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → root");
    expect(component.form.controls.group.disabled).toBe(false);
  });

  it("omits empty user/group and the default restart policy on save", () => {
    create({ ...VLLM_CONFIG, user: "llama", restart: "on-failure" });
    component.form.controls.user.setValue("  ");
    component.form.controls.group.setValue("");
    component.form.controls.restart.setValue("no");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.user).toBeUndefined();
    expect(saved.group).toBeUndefined();
    expect(saved.restart).toBeUndefined();
  });

  it("parses '--enable-chunked-prefill false' as off and emits the --no- variant", () => {
    create({ name: "vllm-x", type: "vllm", command: "/bin/vllm", flags: ["--enable-chunked-prefill false"] });
    expect(component.form.controls.enableChunkedPrefill.value).toBe("off");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toEqual(["--no-enable-chunked-prefill"]);
  });

  it("parses '--no-enable-chunked-prefill' as off", () => {
    create({ name: "vllm-x", type: "vllm", command: "/bin/vllm", flags: ["--no-enable-chunked-prefill"] });
    expect(component.form.controls.enableChunkedPrefill.value).toBe("off");
  });

  it("parses standalone '--enable-chunked-prefill' as on", () => {
    create({ name: "vllm-x", type: "vllm", command: "/bin/vllm", flags: ["--enable-chunked-prefill"] });
    expect(component.form.controls.enableChunkedPrefill.value).toBe("on");
  });

  it("shows draft params only for draft-model spec methods", () => {
    create(null);
    component.form.controls.specMethod.setValue("qwen3_5_mtp");
    expect(component.showSpecDraftParams()).toBe(true);
    component.form.controls.specMethod.setValue("ngram");
    expect(component.showSpecDraftParams()).toBe(false);
    component.form.controls.specMethod.setValue("none");
    expect(component.showSpecDraftParams()).toBe(false);
  });

  it("disables tool-call parser unless auto tool choice is enabled", () => {
    create(null);
    expect(component.isToolCallParserDisabled()).toBe(true);
    component.form.controls.enableAutoToolChoice.setValue(true);
    expect(component.isToolCallParserDisabled()).toBe(false);
  });

  it("cancel closes the dialog without a result", () => {
    create(null);
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });
});
