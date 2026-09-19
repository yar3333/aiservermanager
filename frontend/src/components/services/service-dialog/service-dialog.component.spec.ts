import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatDialogRef, MAT_DIALOG_DATA } from "@angular/material/dialog";
import { ServiceDialogComponent, ServiceDialogData } from "./service-dialog.component";
import { ServiceConfig } from "../../../models/service";

describe("ServiceDialogComponent", () => {
  let fixture: ComponentFixture<ServiceDialogComponent>;
  let component: ServiceDialogComponent;
  let dialogRef: { close: jest.Mock };

  function create(config: ServiceConfig | null, allConfigs: ServiceConfig[] = []) {
    dialogRef = { close: jest.fn() };
    const data: ServiceDialogData = { config, allConfigs };
    TestBed.configureTestingModule({
      imports: [ServiceDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    fixture = TestBed.createComponent(ServiceDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it("validates the service name format", () => {
    create(null);
    const name = component.nameControl;
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
    });
  });

  it("does not close the dialog when the form is invalid", () => {
    create(null);
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
