import { signal } from "@angular/core";
import { buildRunAsLabels } from "./run-as-fields";

describe("buildRunAsLabels", () => {
  it("uses the systemd wording while the backend is unknown or Linux", () => {
    const labels = buildRunAsLabels(signal(false));
    expect(labels.userHint()).toBe("empty → root");
    expect(labels.userPlaceholder()).toBe("llama");
    expect(labels.groupHint()).toBe("systemd Group=");
    expect(labels.isGroupDisabled()).toBe(false);
  });

  it("switches to the Windows wording and locks the group field", () => {
    const windows = signal(false);
    const labels = buildRunAsLabels(windows);

    windows.set(true);

    expect(labels.userHint()).toBe("empty → LocalSystem");
    expect(labels.userPlaceholder()).toBe("llama or HOST\\user");
    expect(labels.groupHint()).toBe("not used on Windows");
    expect(labels.isGroupDisabled()).toBe(true);
  });
});
