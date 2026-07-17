// Mock os
jest.mock("os", () => ({
  userInfo: () => ({ username: "testuser" }),
}));

// Mock ExecTools
const mockSafeExecPs1 = jest.fn();
jest.mock("../../../helpers/ExecTools", () => ({
  ExecTools: { safeExecPs1: mockSafeExecPs1 },
}));

import { WindowsPasswordVerifier } from "../windowsPasswordVerifier";

beforeEach(() => {
  mockSafeExecPs1.mockClear();
});

describe("WindowsPasswordVerifier", () => {
  let verifier: WindowsPasswordVerifier;

  beforeEach(() => {
    verifier = new WindowsPasswordVerifier();
  });

  it("returns true when script outputs OK", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    expect(await verifier.verify("myPassword")).toBe(true);
  });

  it("returns false when script outputs FAIL", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "FAIL\n", stderr: "" });
    expect(await verifier.verify("wrong")).toBe(false);
  });

  it("passes password and username via env variables", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    await verifier.verify("s3cr3t$p@ss");

    expect(mockSafeExecPs1).toHaveBeenCalledWith(
      expect.stringContaining("validatePassword.ps1"),
      expect.objectContaining({
        env: { SM_PASSWORD: "s3cr3t$p@ss", USERNAME: "testuser" },
        timeout: 10_000,
      }),
    );
  });

  it("returns false on empty stdout", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "", stderr: "error" });
    expect(await verifier.verify("test")).toBe(false);
  });

  it("uses safeExecPs1 (file-based) not safeExec (inline)", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    await verifier.verify("test");
    expect(mockSafeExecPs1).toHaveBeenCalledTimes(1);
  });
});
