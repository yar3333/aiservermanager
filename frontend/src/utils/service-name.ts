import { AbstractControl, ValidationErrors, ValidatorFn } from "@angular/forms";
import { ServiceConfig } from "../models/service";

/**
 * Rejects a service name another config already uses.
 *
 * Saving a config addresses it by name, so typing over a running service's name would
 * replace that service instead of renaming this one; the dialog catches it before the
 * request. `currentName` — the name of the config being edited — stays valid, otherwise
 * saving without a rename would flag the field.
 */
export function uniqueServiceName(allConfigs: ServiceConfig[], currentName: string | null): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const name = String(control.value ?? "").trim();
    if (!name || name === currentName) return null;
    return allConfigs.some((cfg) => cfg.name === name) ? { nameTaken: true } : null;
  };
}
