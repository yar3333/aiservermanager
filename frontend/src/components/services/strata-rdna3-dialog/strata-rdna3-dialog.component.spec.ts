import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal, WritableSignal } from "@angular/core";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { of } from "rxjs";
import { StrataRdna3DialogComponent, StrataRdna3DialogData } from "./strata-rdna3-dialog.component";
import { ServiceConfig } from "../../../models/service";
import { ServiceService } from "../../../services/service.service";
import { SystemService } from "../../../services/system.service";
import { GpuService } from "../../../services/gpu.service";
import { Gpu } from "../../../models/gpu";

const RUN_SH = "/home/yar/MyDocs/AiChat/strata-rdna3/run.sh";
const MODEL =
  "/home/yar/.cache/huggingface/hub/models--unsloth--Qwen3.8-Flash-Next-GGUF/snapshots/766911a6b7369840a91dbcd95f9f997acaab6cd6/Q8_0/Qwen3.8-Flash-Next-Q8_0-00001-of-00006.gguf";
const PACK = "/home/yar/.lmstudio/packs/unsloth-ud-q8_0";
const MMPROJ = "/home/yar/.lmstudio/models/mmproj-Qwen3.8-Flash-Next-BF16.gguf";

/** Mirrors ~/.config/aiservermanager/services/strata-qwen3_8_flash-q8-3gpu-256k.conf. */
const TWO_CARD_CONFIG: ServiceConfig = {
  name: "strata-qwen3_8_flash-q8-3gpu-256k",
  type: "strata-rdna3",
  command: RUN_SH,
  flags: [
    `--model ${MODEL}`,
    `--pack ${PACK}`,
    `--mmproj ${MMPROJ}`,
    "--mtp off",
    "--pipeline-windows 0",
    "--conv-cache-mib 4096",
    "--conv-slots 2",
    "--vision on",
    "--vision-dev 2",
    "--toolcall on",
  ],
  user: "yar",
};

/** Mirrors strata-qwen3_8_flash-q8-4gpu-256k.conf: layer split over four cards. */
const FOUR_CARD_CONFIG: ServiceConfig = {
  name: "strata-qwen3_8_flash-q8-4gpu-256k",
  type: "strata-rdna3",
  command: RUN_SH,
  flags: [
    `--model ${MODEL}`,
    `--pack ${PACK}`,
    `--mmproj ${MMPROJ}`,
    "--mtp on",
    "--gpus 0,1,2,3",
    "--tp none",
    "--layer-split 12,24,36",
    "--pipeline-windows 0",
    "--conv-cache-mib 4096",
    "--conv-slots 2",
    "--vision on",
    "--vision-dev 3",
    "--vram-reserve-mib 2048",
    "--toolcall on",
  ],
  user: "yar",
};

const GPUS: Gpu[] = [
  { index: 0, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 0, vramTotal: 24, pciBusId: "03:00.0" },
  { index: 1, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 1, vramTotal: 24, pciBusId: "04:00.0" },
  { index: 2, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 2, vramTotal: 24, pciBusId: "05:00.0" },
  { index: 3, vendor: "AMD", brand: "MSI", name: "Radeon RX 7900 XTX", gpuIndex: 3, vramTotal: 24, pciBusId: "06:00.0" },
];

describe("StrataRdna3DialogComponent", () => {
  let fixture: ComponentFixture<StrataRdna3DialogComponent>;
  let component: StrataRdna3DialogComponent;
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
    const data: StrataRdna3DialogData = { config, allConfigs, clone };
    TestBed.configureTestingModule({
      imports: [StrataRdna3DialogComponent],
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
    fixture = TestBed.createComponent(StrataRdna3DialogComponent);
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
    component.form.controls.name.setValue("strata-test");
    component.form.controls.command.setValue(RUN_SH);
    expect(component.form.valid).toBe(true);
  });

  it("populates the fields an existing config sets and leaves the rest on launcher defaults", () => {
    create(TWO_CARD_CONFIG);
    const f = component.form.controls;
    expect(f.model.value).toBe(MODEL);
    expect(f.pack.value).toBe(PACK);
    expect(f.mmproj.value).toBe(MMPROJ);
    expect(f.mtp.value).toBe("off");
    expect(f.pipelineWindows.value).toBe(0);
    expect(f.convCacheMib.value).toBe(4096);
    expect(f.convSlots.value).toBe("2");
    expect(f.vision.value).toBe("on");
    expect(f.visionDev.value).toBe(2);
    expect(f.toolcall.value).toBe("on");
    // untouched: run.sh defaults
    expect(f.gpus.value).toBe("0,1");
    expect(f.tp.value).toBe("2");
    expect(f.layerSplit.value).toBe("auto");
    expect(f.ctxSize.value).toBe("256K");
    expect(f.kvResident.value).toBe("");
    expect(f.vramReserveMib.value).toBe("");
    expect(f.pleIo.value).toBe("ram");
    expect(f.megakernel.value).toBe("off");
    expect(f.reasoningEffort.value).toBe("medium");
    expect(f.port.value).toBe(4239);
    expect(f.envText.value).toBe("");
    expect(f.user.value).toBe("yar");
  });

  it("round-trips the two-card config flag for flag, in the order the conf already has", () => {
    create(TWO_CARD_CONFIG);
    component.save();
    expect(saved().type).toBe("strata-rdna3");
    expect(saved().command).toBe(RUN_SH);
    expect(saved().flags).toEqual(TWO_CARD_CONFIG.flags);
    expect(saved().user).toBe("yar");
  });

  it("keeps the four-card layout but drops the two flags that repeat a run.sh default", () => {
    create(FOUR_CARD_CONFIG);
    component.save();
    // --mtp on and --vision-dev 3 are what run.sh does anyway, so they are not re-emitted.
    expect(saved().flags).toEqual([
      `--model ${MODEL}`,
      `--pack ${PACK}`,
      `--mmproj ${MMPROJ}`,
      "--gpus 0,1,2,3",
      "--tp none",
      "--layer-split 12,24,36",
      "--pipeline-windows 0",
      "--conv-cache-mib 4096",
      "--conv-slots 2",
      "--vision on",
      "--vram-reserve-mib 2048",
      "--toolcall on",
    ]);
  });

  it("emits nothing but the command for an untouched new service", () => {
    create(null);
    component.form.controls.name.setValue("strata-new");
    component.form.controls.command.setValue(RUN_SH);
    component.save();
    expect(saved().flags).toEqual([]);
    expect(saved().environment).toBeUndefined();
  });

  it("omits --mtp while it stays on and emits --mtp off when switched", () => {
    create(null);
    component.form.controls.name.setValue("strata-new");
    component.form.controls.command.setValue(RUN_SH);
    expect(component.isControlChanged("mtp")).toBe(false);
    component.form.controls.mtp.setValue("off");
    component.save();
    expect(saved().flags).toEqual(["--mtp off"]);
  });

  it("emits a 0 for the fields whose run.sh default means the fork config pair", () => {
    create(TWO_CARD_CONFIG);
    component.form.controls.kvResident.setValue("0");
    component.form.controls.vramReserveMib.setValue("1024");
    component.save();
    expect(saved().flags).toContain("--kv-resident 0");
    expect(saved().flags).toContain("--vram-reserve-mib 1024");

    component.form.controls.kvResident.setValue("");
    component.form.controls.vramReserveMib.setValue("");
    component.save();
    expect(lastSaved().flags).not.toContain("--kv-resident 0");
    expect(lastSaved().flags).not.toContain("--vram-reserve-mib 1024");
  });

  it("writes --vision-dev only while vision is on and locks the field otherwise", () => {
    create(TWO_CARD_CONFIG);
    expect(component.isVisionOn()).toBe(true);
    expect(component.form.controls.visionDev.disabled).toBe(false);

    component.form.controls.vision.setValue("off");
    fixture.detectChanges();
    expect(component.isVisionDevDisabled()).toBe(true);
    expect(component.form.controls.visionDev.disabled).toBe(true);
    component.save();
    expect(lastSaved().flags).not.toContain("--vision-dev 2");
    expect(lastSaved().flags).not.toContain("--vision off");
  });

  it("keeps the reasoning fields for the toolcall branch run.sh reads them in", () => {
    create(TWO_CARD_CONFIG);
    component.form.controls.reasoningEffort.setValue("low");
    component.form.controls.reasoningBudget.setValue("2048");
    component.save();
    expect(saved().flags).toContain("--reasoning-effort low");
    expect(saved().flags).toContain("--reasoning-budget 2048");

    component.form.controls.toolcall.setValue("off");
    fixture.detectChanges();
    expect(component.isReasoningDisabled()).toBe(true);
    expect(component.form.controls.reasoningEffort.disabled).toBe(true);
    component.save();
    expect(lastSaved().flags).not.toContain("--reasoning-effort low");
    expect(lastSaved().flags).not.toContain("--reasoning-budget 2048");
  });

  it("formats the context and emits the raw token count", () => {
    create(TWO_CARD_CONFIG);
    expect(component.form.controls.ctxSize.value).toBe("256K");
    component.form.controls.ctxSize.setValue("128K");
    component.save();
    expect(saved().flags).toContain("--ctx 131072");

    component.form.controls.ctxSize.setValue("");
    component.save();
    expect(lastSaved().flags).not.toContain("--ctx 131072");
  });

  it("keeps launcher arguments it has no field for, verbatim", () => {
    create({
      name: "a",
      type: "strata-rdna3",
      command: RUN_SH,
      flags: ["--model", MODEL, "--some-future-flag 3", "--another one"],
    });
    expect(component.form.controls.model.value).toBe(MODEL);
    expect(component.form.controls.extraFlags.value).toBe("--some-future-flag 3\n--another one");
    component.save();
    expect(saved().flags).toEqual([`--model ${MODEL}`, "--some-future-flag 3", "--another one"]);
  });

  it("collapses the spaces typed into a card or layer list before they reach argv", () => {
    create(null);
    component.form.controls.name.setValue("strata-new");
    component.form.controls.command.setValue(RUN_SH);
    component.form.controls.gpus.setValue("0, 1 , 2");
    component.form.controls.layerSplit.setValue(" 12, 24 ,36 ");
    component.save();
    expect(saved().flags).toEqual(["--gpus 0,1,2", "--layer-split 12,24,36"]);
  });

  it("warns when more than two cards are asked of a tensor-parallel the engine caps at 2", () => {
    create(FOUR_CARD_CONFIG);
    expect(component.isTensorParallelTooNarrow()).toBe(false);

    component.form.controls.tp.setValue("2");
    expect(component.isTensorParallelTooNarrow()).toBe(true);

    component.form.controls.gpus.setValue("0,1");
    expect(component.isTensorParallelTooNarrow()).toBe(false);
  });

  it("warns when the vision card is a model card without a VRAM reserve for the encoder", () => {
    create(TWO_CARD_CONFIG);
    // vision-dev 2 is not among 0,1 — no clash
    expect(component.isVisionCardClash()).toBe(false);

    component.form.controls.visionDev.setValue(1);
    expect(component.isVisionCardClash()).toBe(true);

    component.form.controls.vramReserveMib.setValue("2048");
    expect(component.isVisionCardClash()).toBe(false);

    component.form.controls.vramReserveMib.setValue("2047");
    expect(component.isVisionCardClash()).toBe(true);

    component.form.controls.vision.setValue("off");
    expect(component.isVisionCardClash()).toBe(false);
  });

  it("flags the slow PLE table placement", () => {
    create(TWO_CARD_CONFIG);
    expect(component.isPleIoSlow()).toBe(false);
    component.form.controls.pleIo.setValue("direct");
    expect(component.isPleIoSlow()).toBe(true);
    component.save();
    expect(saved().flags).toContain("--ple-io direct");
  });

  it("hands the API key and friends to the environment textarea", () => {
    create({
      name: "a",
      type: "strata-rdna3",
      command: RUN_SH,
      flags: [],
      environment: { API_KEY: "sk-x", PATH: "/opt/rocm-7.2.2/bin" },
    });
    expect(component.form.controls.envText.value).toBe("API_KEY=sk-x\nPATH=/opt/rocm-7.2.2/bin\n");
    component.form.controls.envText.setValue("API_KEY=sk-y\n# note\nBROKEN\n");
    component.save();
    expect(saved().environment).toEqual({ API_KEY: "sk-y" });
  });

  it("offers the runtime card numbers of this host and the paths other configs use", () => {
    create(null, [TWO_CARD_CONFIG]);
    expect(component.gpuIndices()).toEqual([0, 1, 2, 3]);
    expect(component.gpuSummary()).toContain("0 — Radeon RX 7900 XTX");
    expect(component.existingModelPaths()).toEqual([MODEL]);
    expect(component.existingPackPaths()).toEqual([PACK]);
    expect(component.existingMmprojPaths()).toEqual([MMPROJ]);
  });

  it("preserves workingDirectory and stopCommand, which have no field here", () => {
    create({ ...TWO_CARD_CONFIG, workingDirectory: "/home/yar/MyDocs/AiChat/strata-rdna3", stopCommand: "/bin/true" });
    component.save();
    expect(saved().workingDirectory).toBe("/home/yar/MyDocs/AiChat/strata-rdna3");
    expect(saved().stopCommand).toBe("/bin/true");
  });

  it("prefills and saves run-as + restart policy, omitting the empty ones", () => {
    create({ ...TWO_CARD_CONFIG, user: "yar", group: "ai", restart: "always" });
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
    create({ ...TWO_CARD_CONFIG, user: "yar", group: "ai" }, [], false, GPUS, true);
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → LocalSystem");
    expect(component.runAs.groupHint()).toBe("not used on Windows");
    expect(component.form.controls.group.disabled).toBe(true);
  });

  it("marks changed fields against the launcher defaults", () => {
    create(TWO_CARD_CONFIG);
    expect(component.isControlChanged("model")).toBe(true);
    expect(component.isControlChanged("mtp")).toBe(true);
    expect(component.isControlChanged("gpus")).toBe(false);
    expect(component.isControlChanged("convSlots")).toBe(true);
    expect(component.isControlChanged("kvResident")).toBe(false);
    expect(component.isSectionChanged("gpus", "tp")).toBe(false);
    expect(component.isSectionChanged("gpus", "mtp")).toBe(true);
  });

  it("renders the card fields and the encoder warning wired to their controls", () => {
    create(TWO_CARD_CONFIG);
    const el = fixture.nativeElement as HTMLElement;

    const gpusInput = el.querySelector('input[formcontrolname="gpus"]') as HTMLInputElement;
    expect(gpusInput).not.toBeNull();
    expect(el.querySelector(".hint-warning")).toBeNull();

    component.form.controls.visionDev.setValue(1);
    fixture.detectChanges();
    expect(el.querySelector(".hint-warning")?.textContent).toContain("2048");
  });

  it("renames the service and refuses a name another config already holds", () => {
    create(TWO_CARD_CONFIG, [
      TWO_CARD_CONFIG,
      { name: "vllm-qwen", type: "vllm", command: "/bin/vllm", flags: [] },
    ]);
    const name = component.form.controls.name;

    expect(name.disabled).toBe(false);
    expect(name.valid).toBe(true);

    name.setValue("strata-renamed");
    expect(name.valid).toBe(true);
    component.save();
    expect(lastSaved().name).toBe("strata-renamed");

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
