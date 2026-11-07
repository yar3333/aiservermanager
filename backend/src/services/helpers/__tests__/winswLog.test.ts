import { parseWinSwLogLine } from "../winswLog";

describe("parseWinSwLogLine", () => {
  it("moves WinSW's own stamp out of the message", () => {
    const line = "2026-11-06 23:02:13,678 INFO  - Service 'comfyui (comfyui)' was installed successfully.";
    const entry = parseWinSwLogLine(line, "2026-11-06T20:15:28.003Z");

    // WinSW writes local time; the expected value is built the same way so the
    // assertion does not depend on the machine's zone.
    expect(entry.timestamp).toBe(new Date(2026, 10, 6, 23, 2, 13, 678).toISOString());
    expect(entry.message).toBe("INFO  - Service 'comfyui (comfyui)' was installed successfully.");
  });

  it("keeps the file timestamp for raw program output", () => {
    const entry = parseWinSwLogLine("serving on http://127.0.0.1:8188", "2026-11-06T20:15:28.003Z");

    expect(entry).toEqual({ timestamp: "2026-11-06T20:15:28.003Z", message: "serving on http://127.0.0.1:8188" });
  });

  it("accepts an ISO separator and a shorter fraction", () => {
    const entry = parseWinSwLogLine("2026-11-06T23:02:13.5 DEBUG - starting", "fallback");

    expect(entry.timestamp).toBe(new Date(2026, 10, 6, 23, 2, 13, 500).toISOString());
    expect(entry.message).toBe("DEBUG - starting");
  });

  it("does not mistake output that merely starts with a number for a stamp", () => {
    const entry = parseWinSwLogLine("200 % of the models are loaded", "fallback");

    expect(entry).toEqual({ timestamp: "fallback", message: "200 % of the models are loaded" });
  });
});
