import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal, WritableSignal } from "@angular/core";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { of } from "rxjs";
import { LlamaServerDialogComponent, LlamaServerDialogData } from "./llama-server-dialog.component";
import { ServiceConfig } from "../../../models/service";
import { ServiceService } from "../../../services/service.service";
import { SystemService } from "../../../services/system.service";

/** Mirrors ~/.config/aiservermanager/services/llama-qwen-bf16-3gpu.conf + env + an unknown flag. */
const LLAMA_CONFIG: ServiceConfig = {
  name: "llama-qwen-bf16-3gpu",
  type: "llama-server",
  command: "/home/yar/MyDocs/AiChat/llama/llama-rocm/llama-server",
  flags: [
    "--host 0.0.0.0",
    "--port 4239",
    "--model /home/yar/.lmstudio/models/unsloth/Qwen3.8-27B-GGUF/Qwen3.8-27B-BF16-00001-of-00002.gguf",
    "--ctx-size 196608",
    "--spec-type draft-mtp",
    "--some-future-flag 42",
  ],
  environment: { HSA_OVERRIDE_GFX_VERSION: "11.0.0" },
};

describe("LlamaServerDialogComponent (Additional section)", () => {
  let fixture: ComponentFixture<LlamaServerDialogComponent>;
  let component: LlamaServerDialogComponent;
  let dialogRef: { close: jest.Mock };
  let backendWindows: WritableSignal<boolean>;

  function create(config: ServiceConfig | null, allConfigs: ServiceConfig[] = [], windows = false) {
    dialogRef = { close: jest.fn() };
    backendWindows = signal(false);
    const data: LlamaServerDialogData = { config, allConfigs };
    TestBed.configureTestingModule({
      imports: [LlamaServerDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ServiceService, useValue: { getLlamaAutocomplete: jest.fn().mockReturnValue(of([])) } },
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
    fixture = TestBed.createComponent(LlamaServerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it("populates extraFlags with flags not covered by form fields", () => {
    create(LLAMA_CONFIG);
    expect(component.form.controls.extraFlags.value).toBe("--some-future-flag 42");
  });

  it("populates envText from config.environment", () => {
    create(LLAMA_CONFIG);
    expect(component.form.controls.envText.value).toBe("HSA_OVERRIDE_GFX_VERSION=11.0.0\n");
  });

  it("appends extra flags after the structured ones and keeps them verbatim", () => {
    create(LLAMA_CONFIG);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--some-future-flag 42");
    expect(saved.flags[saved.flags.length - 1]).toBe("--some-future-flag 42");
    // structured flags still present
    expect(saved.flags).toContain("--host 0.0.0.0");
    expect(saved.flags).toContain("--ctx-size 196608");
    expect(saved.flags).toContain("--spec-type draft-mtp");
  });

  it("saves environment variables from the textarea", () => {
    create(LLAMA_CONFIG);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toEqual({ HSA_OVERRIDE_GFX_VERSION: "11.0.0" });
  });

  it("omits the environment key when the textarea is empty", () => {
    create({ name: "llama-min", type: "llama-server", command: "/bin/llama-server", flags: [] });
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.environment).toBeUndefined();
  });

  it("prefills and saves service unit run-as + restart fields", () => {
    create({ ...LLAMA_CONFIG, user: "llama", group: "ai", restart: "always" });
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
    create({ ...LLAMA_CONFIG, user: "llama", group: "ai" }, [], true);
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → LocalSystem");
    expect(component.runAs.groupHint()).toBe("not used on Windows");
    expect(component.form.controls.group.disabled).toBe(true);
  });

  it("keeps the group field editable on a Linux backend", async () => {
    create({ ...LLAMA_CONFIG, user: "llama", group: "ai" });
    await fixture.whenStable();

    expect(component.runAs.userHint()).toBe("empty → root");
    expect(component.form.controls.group.disabled).toBe(false);
  });

  it("omits empty user/group and the default restart policy on save", () => {
    create({ ...LLAMA_CONFIG, user: "llama", restart: "on-failure" });
    component.form.controls.user.setValue("  ");
    component.form.controls.group.setValue("");
    component.form.controls.restart.setValue("no");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.user).toBeUndefined();
    expect(saved.group).toBeUndefined();
    expect(saved.restart).toBeUndefined();
  });

  it("round-trips unknown flags and environment through an edit without loss", () => {
    create(LLAMA_CONFIG);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.type).toBe("llama-server");
    expect(new Set(saved.flags).size).toBe(saved.flags.length);
  });

  it("strips comments and blank lines from the env textarea", () => {
    create(null);
    component.form.controls.envText.setValue("# comment\nKEY1=val1\n\nKEY2=val2\n");
    expect(component.parseEnvironment()).toEqual({ KEY1: "val1", KEY2: "val2" });
  });
});

describe("LlamaServerDialogComponent (composite spec-type)", () => {
  let fixture: ComponentFixture<LlamaServerDialogComponent>;
  let component: LlamaServerDialogComponent;
  let dialogRef: { close: jest.Mock };

  function create(config: ServiceConfig | null, allConfigs: ServiceConfig[] = []) {
    dialogRef = { close: jest.fn() };
    const data: LlamaServerDialogData = { config, allConfigs };
    TestBed.configureTestingModule({
      imports: [LlamaServerDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: ServiceService, useValue: { getLlamaAutocomplete: jest.fn().mockReturnValue(of([])) } },
        {
          provide: SystemService,
          useValue: { windows: signal(false), detectWindows: jest.fn().mockResolvedValue(false) },
        },
      ],
    });
    fixture = TestBed.createComponent(LlamaServerDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it("emits both draft and ngram-mod flags for draft-mtp,ngram-mod", () => {
    create({ name: "llama-spec", type: "llama-server", command: "/bin/llama-server", flags: [] });
    component.form.controls.specType.setValue("draft-mtp,ngram-mod");
    component.form.controls.modelDraft.setValue("/models/draft.gguf");
    component.form.controls.specNgramModNMin.setValue(64);
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--spec-type draft-mtp,ngram-mod");
    expect(saved.flags).toContain("--model-draft /models/draft.gguf");
    expect(saved.flags).toContain("--spec-ngram-mod-n-min 64");
  });

  it("shows draft and ngram-mod sections for the composite type", () => {
    create({ name: "llama-spec", type: "llama-server", command: "/bin/llama-server", flags: [] });
    component.form.controls.specType.setValue("draft-mtp,ngram-mod");
    expect(component.showDraftParams()).toBe(true);
    expect(component.showNgramModParams()).toBe(true);
    expect(component.showNgramSimpleParams()).toBe(false);
  });

  it("round-trips a composite spec-type from an existing config", () => {
    create({
      name: "llama-spec",
      type: "llama-server",
      command: "/bin/llama-server",
      flags: [
        "--spec-type draft-mtp,ngram-mod",
        "--model-draft /models/draft.gguf",
        "--spec-ngram-mod-n-min 64",
      ],
    });
    expect(component.form.controls.specType.value).toBe("draft-mtp,ngram-mod");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0] as ServiceConfig;
    expect(saved.flags).toContain("--spec-type draft-mtp,ngram-mod");
    expect(saved.flags).toContain("--model-draft /models/draft.gguf");
    expect(saved.flags).toContain("--spec-ngram-mod-n-min 64");
  });
});
