import { signal, WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { syncDisabledControls } from "./disabled-controls";

describe("syncDisabledControls", () => {
  let fb: FormBuilder;
  let enabled: WritableSignal<boolean>;

  function createForm(locked: string[]) {
    const form = fb.group({
      name: ["comfyui"],
      group: ["ai"],
      port: [8080],
    });
    const state: Record<string, boolean> = Object.fromEntries(locked.map((field) => [field, true]));
    TestBed.runInInjectionContext(() =>
      syncDisabledControls(form, () => ({ ...state, group: enabled() })),
    );
    return form;
  }

  beforeEach(() => {
    fb = new FormBuilder();
    enabled = signal(false);
  });

  it("locks the fields the state names", () => {
    const form = createForm(["name"]);
    TestBed.flushEffects();

    expect(form.controls.name.disabled).toBe(true);
    expect(form.controls.port.disabled).toBe(false);
  });

  it("keeps the value of a locked control so the field is still saved", () => {
    const form = createForm(["name"]);
    TestBed.flushEffects();

    expect(form.controls.name.value).toBe("comfyui");
  });

  it("locks and unlocks as the signal it reads changes", () => {
    const form = createForm([]);
    TestBed.flushEffects();
    expect(form.controls.group.disabled).toBe(false);

    enabled.set(true);
    TestBed.flushEffects();
    expect(form.controls.group.disabled).toBe(true);

    enabled.set(false);
    TestBed.flushEffects();
    expect(form.controls.group.disabled).toBe(false);
  });

  it("ignores a name the form does not have", () => {
    const form = createForm(["typicalP"]);
    TestBed.flushEffects();

    expect(Object.keys(form.controls)).toEqual(["name", "group", "port"]);
  });
});
