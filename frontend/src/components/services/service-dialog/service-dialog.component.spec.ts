import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { signal, WritableSignal } from "@angular/core";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { ServiceDialogComponent, ServiceDialogData } from "./service-dialog.component";
import { ServiceConfig } from "../../../models/service";
import { SystemService } from "../../../services/system.service";

describe("ServiceDialogComponent", () => {
  let fixture: ComponentFixture<ServiceDialogComponent>;
  let component: ServiceDialogComponent;
  let dialogRef: { close: jest.Mock };
  let backendWindows: WritableSignal<boolean>;

  function create(
    config: ServiceConfig | null,
    allConfigs: ServiceConfig[] = [],
    windows = false,
    clone = false,
  ) {
    dialogRef = { close: jest.fn() };
    backendWindows = signal(windows);
    const data: ServiceDialogData = { config, allConfigs, clone };
    TestBed.configureTestingModule({
      imports: [ServiceDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
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
    fixture = TestBed.createComponent(ServiceDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  /** Let the backend platform answer arrive and the dialog re-render. */
  async function platformSettled(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function groupInput(): HTMLInputElement {
    return fixture.debugElement.queryAll(By.css("input")).find((el) => el.nativeElement.placeholder === "ai")!
      .nativeElement as HTMLInputElement;
  }

  /** The run-as user field — its placeholder is the only one starting with "llama". */
  function userInput(): HTMLInputElement {
    return fixture.debugElement
      .queryAll(By.css("input"))
      .find((el) => String(el.nativeElement.placeholder).startsWith("llama"))!.nativeElement as HTMLInputElement;
  }

  it("validates the service name format", () => {
    create(null);
    const name = component.nameControl;
    expect(name.disabled).toBe(false);
    expect(name.valid).toBe(false); // required
    name.setValue("bad name!");
    expect(name.valid).toBe(false);
    name.setValue("good-name_1");
    expect(name.valid).toBe(true);
  });

  it("requires a command", () => {
    create(null);
    const command = component.commandControl;
    expect(command.valid).toBe(false);
    command.setValue("/usr/bin/llama-server");
    expect(command.valid).toBe(true);
  });

  it("prefills the flags textarea from an existing config", () => {
    create({ name: "llama-server", command: "/bin/llama-server", flags: ["--model m.gguf", "--port 8080"] });
    expect(component.form.get("flagsText")!.value).toBe("--model m.gguf\n--port 8080\n");
  });

  it("strips comments and blank lines when saving flags", () => {
    create({ name: "llama-server", command: "/bin/llama-server", flags: [] });
    component.form.get("flagsText")!.setValue("--model m.gguf\n\n# keep this comment out\n--port 8080\n");
    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith({
      name: "llama-server",
      type: "generic",
      command: "/bin/llama-server",
      flags: ["--model m.gguf", "--port 8080"],
      environment: {},
    });
  });

  it("does not close the dialog when the form is invalid", () => {
    create(null);
    component.save();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("prefills and saves user, group and restart", () => {
    create({
      name: "llama-server",
      command: "/bin/llama-server",
      flags: [],
      user: "llama",
      group: "ai",
      restart: "always",
    });
    expect(component.form.get("user")!.value).toBe("llama");
    expect(component.form.get("group")!.value).toBe("ai");
    expect(component.form.get("restart")!.value).toBe("always");

    component.save();
    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ user: "llama", group: "ai", restart: "always" }),
    );
  });

  it("omits empty user/group and the default restart policy on save", () => {
    create({ name: "svc", command: "/bin/x", flags: [], user: "old", group: "g", restart: "on-failure" });
    component.form.get("user")!.setValue("  ");
    component.form.get("group")!.setValue("");
    component.form.get("restart")!.setValue("no");
    component.save();
    const saved = dialogRef.close.mock.calls[0][0];
    expect(saved.user).toBeUndefined();
    expect(saved.group).toBeUndefined();
    expect(saved.restart).toBeUndefined();
  });

  it("sends no password — the credential is asked when the service is registered", () => {
    create({
      name: "comfyui",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: [],
      user: "ynote2\\Yaroslav",
      runAsPassword: "should-not-travel-back",
    });
    component.save();

    const saved = dialogRef.close.mock.calls[0][0];
    expect(saved.user).toBe("ynote2\\Yaroslav");
    expect(saved.runAsPassword).toBeUndefined();
  });

  it("keeps conf keys the dialog has no field for", () => {
    create({
      name: "comfyui",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: [],
      workingDirectory: "C:\\AiPic\\system",
      stopCommand: "C:\\tools\\stop-comfy.cmd /fast",
    });
    component.save();

    const saved = dialogRef.close.mock.calls[0][0];
    expect(saved.workingDirectory).toBe("C:\\AiPic\\system");
    expect(saved.stopCommand).toBe("C:\\tools\\stop-comfy.cmd /fast");
  });

  it("explains an empty user field the way a Linux backend reads it", async () => {
    create(null);
    await platformSettled();

    expect(component.runAs.userHint()).toBe("empty → root");
    expect(component.runAs.groupHint()).toBe("systemd Group=");
    expect(userInput().placeholder).toBe("llama");
    expect(component.form.controls.group.disabled).toBe(false);
    expect(groupInput().disabled).toBe(false);
  });

  it("says LocalSystem and locks the group field on a Windows backend", async () => {
    create({ name: "comfyui", command: "C:\\AiPic\\run.cmd", flags: [], user: "Yaroslav", group: "ai" }, [], true);
    await platformSettled();

    expect(component.runAs.userHint()).toBe("empty → LocalSystem");
    expect(component.runAs.groupHint()).toBe("not used on Windows");
    expect(userInput().placeholder).toBe("llama or HOST\\user");
    expect(component.form.controls.group.disabled).toBe(true);
    expect(groupInput().disabled).toBe(true);
  });

  it("keeps a configured group in the conf while the field is locked", async () => {
    create({ name: "comfyui", command: "C:\\AiPic\\run.cmd", flags: [], user: "Yaroslav", group: "ai" }, [], true);
    await platformSettled();

    component.save();
    expect(dialogRef.close.mock.calls[0][0].group).toBe("ai");
  });

  it("keeps the name editable while editing, so the service can be renamed", () => {
    create({ name: "comfyui", command: "C:\\AiPic\\run.cmd", flags: [] });

    const name = component.form.controls.name;
    expect(name.disabled).toBe(false);
    name.setValue("comfyui-cuda");
    expect(name.valid).toBe(true);

    component.save();
    expect(dialogRef.close.mock.calls[0][0].name).toBe("comfyui-cuda");
  });

  it("rejects a name another service already uses", () => {
    const comfyui: ServiceConfig = { name: "comfyui", command: "C:\\AiPic\\run.cmd", flags: [] };
    create(comfyui, [comfyui, { name: "llama-qwen", command: "/bin/llama-server", flags: [] }]);

    const name = component.form.controls.name;
    expect(name.valid).toBe(true); // its own name must stay valid
    name.setValue("llama-qwen");
    expect(name.hasError("nameTaken")).toBe(true);
    expect(component.form.valid).toBe(false);

    component.save();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it("cancel closes the dialog without a result", () => {
    create(null);
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith();
  });

  it("allExistingCommands excludes the current config and dedupes commands", () => {
    const current: ServiceConfig = { name: "svc-a", command: "/bin/a", flags: [] };
    const all: ServiceConfig[] = [
      current,
      { name: "svc-b", command: "/bin/b", flags: [] },
      { name: "svc-c", command: "/bin/b", flags: [] },
      { name: "svc-d", command: "/bin/d", flags: [] },
    ];
    create(current, all);
    expect(component.allExistingCommands()).toEqual([
      { command: "/bin/b", from: "svc-b" },
      { command: "/bin/d", from: "svc-d" },
    ]);
  });

  it("filters existing commands by command or origin name", () => {
    create(null, [
      { name: "svc-b", command: "/bin/llama-server", flags: [] },
      { name: "svc-d", command: "/bin/comfyui", flags: [] },
    ]);
    component.form.get("command")!.setValue("comfy");
    expect(component.filteredCommands()).toEqual([{ command: "/bin/comfyui", from: "svc-d" }]);
  });
});
