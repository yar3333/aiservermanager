import { findFlag, flagBool, flagValueFloat, flagValueNum, flagValueStr } from "./flag-parsing";

describe("findFlag", () => {
  it("finds separate tokens: [--flag, value]", () => {
    expect(findFlag(["--model", "/models/llama.gguf"], "--model")).toBe("/models/llama.gguf");
  });

  it("finds a single string with space: [--flag value]", () => {
    expect(findFlag(["--host 127.0.0.1"], "--host")).toBe("127.0.0.1");
  });

  it("finds a single string with equals: [--flag=value]", () => {
    expect(findFlag(["--ctx-size=4096"], "--ctx-size")).toBe("4096");
  });

  it("returns null when the flag is absent", () => {
    expect(findFlag(["--model", "x"], "--port")).toBeNull();
  });

  it("returns null when the flag is the last token without a value", () => {
    expect(findFlag(["--model"], "--model")).toBeNull();
  });

  it("matches the exact flag name, not a prefix", () => {
    expect(findFlag(["--model-draft", "d.gguf"], "--model")).toBeNull();
  });
});

describe("flagBool", () => {
  it("recognizes the positive and negative variants", () => {
    expect(flagBool(["--mmap"], "--mmap", "--no-mmap", true)).toBe(true);
    expect(flagBool(["--no-mmap"], "--mmap", "--no-mmap", true)).toBe(false);
  });

  it("returns the fallback when neither variant is present", () => {
    expect(flagBool(["--host x"], "--mmap", "--no-mmap", true)).toBe(true);
    expect(flagBool([], "--mmap", "--no-mmap", false)).toBe(false);
  });

  it("handles the combined [--flag on] form", () => {
    expect(flagBool(["--cont-batching on"], "--cont-batching", "--no-cont-batching", true)).toBe(true);
    expect(flagBool(["--no-cont-batching on"], "--cont-batching", "--no-cont-batching", true)).toBe(false);
  });
});

describe("flagValueStr", () => {
  it("returns the flag value or the fallback", () => {
    expect(flagValueStr(["--host 1.2.3.4"], "--host", "127.0.0.1")).toBe("1.2.3.4");
    expect(flagValueStr([], "--host", "127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("flagValueNum", () => {
  it("parses integer values in all three formats", () => {
    expect(flagValueNum(["--port", "8080"], "--port", 0)).toBe(8080);
    expect(flagValueNum(["--port 9090"], "--port", 0)).toBe(9090);
    expect(flagValueNum(["--port=7070"], "--port", 0)).toBe(7070);
  });

  it("falls back on missing or unparseable values", () => {
    expect(flagValueNum([], "--port", 42)).toBe(42);
    expect(flagValueNum(["--port abc"], "--port", 42)).toBe(42);
  });
});

describe("flagValueFloat", () => {
  it("parses float values", () => {
    expect(flagValueFloat(["--temperature", "0.8"], "--temperature", 0)).toBe(0.8);
    expect(flagValueFloat(["--rope-scale 1.5"], "--rope-scale", 1)).toBe(1.5);
  });

  it("falls back on missing value", () => {
    expect(flagValueFloat([], "--temperature", 1)).toBe(1);
  });
});
