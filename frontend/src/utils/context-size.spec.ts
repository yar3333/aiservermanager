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
    expect(formatShort(2621440)).toBe("2.5M");
  });
});

describe("formatContextSize", () => {
  it("returns empty for non-positive values", () => {
    expect(formatContextSize(0, 1)).toBe("");
  });

  it("uses the multiplier form when divisible by a known preset", () => {
    expect(formatContextSize(65536, 4)).toBe("4 x 16K");
  });

  it("falls back to the short form otherwise", () => {
    expect(formatContextSize(20000, 1)).toBe("19.5K");
  });

  it("exposes the expected preset sizes", () => {
    expect(CONTEXT_PRESETS).toContain(8192);
    expect(CONTEXT_PRESETS).toContain(1048576);
  });
});
