import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { of } from "rxjs";
import { VllmDialogComponent, VllmDialogData } from "./vllm-dialog.component";
import { ServiceConfig } from "../../../models/service";
import { ServiceService } from "../../../services/service.service";

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

describe("VllmDialogComponent", () => {
  let fixture: ComponentFixture<VllmDialogComponent>;
  let component: VllmDialogComponent;
  let dialogRef: { close: jest.Mock };

  function create(config: ServiceConfig | null, allConfigs: ServiceConfig[] = [], clone = false) {
    dialogRef = { close: jest.fn() };
    const data: VllmDialogData = { config, allConfigs, clone };
    TestBed.configureTestingModule({
      imports: [VllmDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ServiceService, useValue: { getLlamaAutocomplete: jest.fn().mockReturnValue(of([])) } },
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

  it("populates served model name and aliases from repeated --served-model-name", () => {
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
    const f = component.form.controls;
    expect(f.servedModelName.value).toBe("qwen-256k");
    expect(f.servedModelAliases.value).toBe("qwen-256k-fast, qwen");
  });

  it("keeps a single --served-model-name as the name with empty aliases", () => {
    create(VLLM_CONFIG);
    const f = component.form.controls;
    expect(f.servedModelName.value).toBe("qwen-256k");
    expect(f.servedModelAliases.value).toBe("");
  });

  it("round-trips a config with model aliases through save() unchanged", () => {
    const config: ServiceConfig = {
      name: "vllm-alias",
      type: "vllm",
      command: "/bin/vllm",
      flags: [
        "serve test/model",
        "--served-model-name qwen-256k",
        "--served-model-name qwen-256k-fast",
        "--served-model-name qwen",
        "--host 0.0.0.0",
        "--port 4239",
      ],
    };
    create(config);
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining(config));
  });

  it("emits one --served-model-name per alias and ignores empty entries", () => {
    create(null);
    const f = component.form.controls;
    f.name.setValue("vllm-new");
    f.command.setValue("/bin/vllm");
    f.model.setValue("test/model");
    f.servedModelName.setValue("qwen");
    f.servedModelAliases.setValue("qwen-fast, qwen2,  ");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--served-model-name qwen");
    expect(saved.flags).toContain("--served-model-name qwen-fast");
    expect(saved.flags).toContain("--served-model-name qwen2");
    expect(saved.flags.filter((x) => x.startsWith("--served-model-name")).length).toBe(3);
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
