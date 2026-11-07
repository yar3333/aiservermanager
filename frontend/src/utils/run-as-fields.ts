import { computed, Signal } from "@angular/core";

/**
 * Labels and enabling rules for the "run as" fields of a service.
 *
 * The fields mean different things per backend OS: systemd has `Group=` and a service
 * without `User=` runs as root, while a Windows service has no group at all and an
 * account-less service runs as LocalSystem. The wording therefore follows the backend,
 * not the browser.
 */
export interface RunAsLabels {
  /** What an empty user field means on this backend. */
  readonly userHint: Signal<string>;
  /** Sample account name — systemd reads a bare name only, Windows also takes HOST\user. */
  readonly userPlaceholder: Signal<string>;
  /** What the group field does on this backend. */
  readonly groupHint: Signal<string>;
  /** Windows services have no group, so the field is not editable there. */
  readonly isGroupDisabled: Signal<boolean>;
}

export function buildRunAsLabels(windows: Signal<boolean>): RunAsLabels {
  return {
    userHint: computed(() => (windows() ? "empty → LocalSystem" : "empty → root")),
    userPlaceholder: computed(() => (windows() ? "llama or HOST\\user" : "llama")),
    groupHint: computed(() => (windows() ? "not used on Windows" : "systemd Group=")),
    isGroupDisabled: computed(() => windows()),
  };
}
