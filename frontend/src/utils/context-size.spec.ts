import { CONTEXT_PRESETS, formatContextSize, formatShort, parseContextSize } from "./context-size";

describe("parseContextSize", () => {
  it("parses plain numbers", () => {
    expect(parseContextSize("20000")).toBe(20000);
    expect(parseContextSize("0")).toBe(0);
    expect(parseContextSize("")).toBe(0);
    expect(parseContextSize(16384)).toBe(16384);
  });

  it("parses k/m unit suffixes", () => {
    expect(parseContextSize("20k")).toBe(20480);
    expect(parseContextSize("20 K")).toBe(20480);
    expect(parseContextSize("1M")).toBe(1048576);
  });

  it("parses the Nx multiplier form", () => {
    expect(parseContextSize("3x20k")).toBe(61440);
    expect(parseContextSize("3 x 20k")).toBe(61440);
    expect(parseContextSize("2x16384")).toBe(32768);
  });

  it("parses fractional unit suffixes instead of dropping them to 0", () => {
    // Regression: a value saved/typed as a fractional suffixed form used to parse to 0
    // (the regex only accepted integer mantissas), which silently dropped the flag on save
    // and made the value disappear when the dialog was reopened.
    expect(parseContextSize("19.5K")).toBe(19968);
    expect(parseContextSize("2.5M")).toBe(2621440);
    expect(parseContextSize("1.5K")).toBe(1536);
  });

  it("returns 0 for garbage input", () => {
    expect(parseContextSize("abc")).toBe(0);
    expect(parseContextSize("20kb")).toBe(0);
  });
});

describe("formatShort", () => {
  it("formats small numbers as-is", () => {
    expect(formatShort(0)).toBe("0");
    expect(formatShort(512)).toBe("512");
  });

  it("formats kilobytes", () => {
    expect(formatShort(8192)).toBe("8K");
    expect(formatShort(20480)).toBe("20K");
  });

  it("formats megabytes", () => {
    expect(formatShort(1048576)).toBe("1M");
    expect(formatShort(2097152)).toBe("2M");
  });

  it("collapses to K/M only when the value is an exact multiple, otherwise keeps the raw number", () => {
    // Regression: non-multiples used to collapse to a lossy fractional suffix
    // ("19.5K", "2.5M") which parseContextSize could not read back.
    expect(formatShort(20000)).toBe("20000"); // 19.53125K — not an exact K multiple
    expect(formatShort(15000)).toBe("15000"); // not an exact K multiple
    expect(formatShort(2621440)).toBe("2560K"); // not an exact M (2.5M) but an exact K (2560K)
    expect(formatShort(1500000)).toBe("1500000"); // exact neither M nor K
    // Exact multiples still collapse.
    expect(formatShort(16384)).toBe("16K");
    expect(formatShort(3145728)).toBe("3M");
  });
});

describe("formatContextSize", () => {
  it("returns empty for non-positive values", () => {
    expect(formatContextSize(0, 1)).toBe("");
  });

  it("uses the multiplier form when divisible by a known preset", () => {
    expect(formatContextSize(65536, 4)).toBe("4 x 16K");
  });

  it("keeps a raw decimal for values that are not an exact multiple (no lossy fractional suffix)", () => {
    // Regression: entering 20000 used to be rewritten to "19.5K" on blur.
    expect(formatContextSize(20000, 1)).toBe("20000");
    expect(formatContextSize(1500000, 1)).toBe("1500000");
    // Exact multiples still collapse to the short form.
    expect(formatContextSize(262144, 1)).toBe("256K");
    expect(formatContextSize(1048576, 1)).toBe("1M");
  });

  it("exposes the expected preset sizes", () => {
    expect(CONTEXT_PRESETS).toContain(8192);
    expect(CONTEXT_PRESETS).toContain(1048576);
  });
});

describe("format ↔ parse round-trip (value must not disappear)", () => {
  it("formatting a value and parsing it back yields the original value", () => {
    // Regression: the max-model-len / ctx-size field rewrote non-multiple input to a
    // fractional suffix (e.g. 20000 → "19.5K") that parseContextSize read back as 0,
    // so the flag was dropped on save and the value vanished on reopening the dialog.
    const values = [512, 15000, 20000, 16384, 20480, 262144, 1048576, 1500000, 2621440, 3145728];
    for (const n of values) {
      expect(parseContextSize(formatContextSize(n, 1))).toBe(n);
    }
  });
});
