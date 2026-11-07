import { effect } from "@angular/core";
import { AbstractControl } from "@angular/forms";

/** Anything a child control can be looked up in — a FormGroup of any typing. */
type ControlOwner = { get(name: string): AbstractControl | null };

/**
 * Lock the fields a given state says are locked.
 *
 * Angular ignores a `disabled` binding on an element that carries `formControlName` — the
 * directive's setter only logs a warning — so the state has to be put on the control
 * itself. That is what happens here, inside an effect: every signal the state function
 * reads is tracked, so the fields lock and unlock as the rest of the form changes.
 *
 * A locked control keeps its value, so a greyed-out field is still saved into the config,
 * and `emitEvent: false` keeps locking or unlocking from arriving as an edit of the form.
 */
export function syncDisabledControls(form: ControlOwner, state: () => Record<string, boolean>): void {
  effect(() => {
    for (const [name, isDisabled] of Object.entries(state())) {
      const control = form.get(name);
      if (!control) continue;
      if (isDisabled && control.enabled) control.disable({ emitEvent: false });
      else if (!isDisabled && control.disabled) control.enable({ emitEvent: false });
    }
  });
}
