let fakeUser = "testuser";

jest.mock("os", () => ({
  userInfo: () => ({ username: fakeUser }),
  hostname: () => "WORKSTATION",
}));

// Mock ExecTools
const mockSafeExecPs1 = jest.fn();
jest.mock("../../../helpers/ExecTools", () => ({
  ExecTools: { safeExecPs1: mockSafeExecPs1 },
}));

import { WindowsPasswordVerifier } from "../windowsPasswordVerifier";

const ORIGINAL_AUTH_USER = process.env.AUTH_USER;
const ORIGINAL_COMPUTERNAME = process.env.COMPUTERNAME;

beforeEach(() => {
  mockSafeExecPs1.mockClear();
  fakeUser = "testuser";
  process.env.AUTH_USER = "Yaroslav";
  process.env.COMPUTERNAME = "YHOST";
});

afterAll(() => {
  process.env.AUTH_USER = ORIGINAL_AUTH_USER;
  process.env.COMPUTERNAME = ORIGINAL_COMPUTERNAME;
});

describe("WindowsPasswordVerifier", () => {
  let verifier: WindowsPasswordVerifier;

  beforeEach(() => {
    verifier = new WindowsPasswordVerifier();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("accepts the script's OK answer", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    expect(await verifier.verify("myPassword")).toEqual({ status: "ok" });
  });

  it("counts only LogonUser's logon-failure code as a wrong password", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "FAIL 1326\n", stderr: "" });

    expect(await verifier.verify("wrong")).toMatchObject({ status: "denied", detail: "FAIL 1326" });
  });

  it("reports any other LogonUser code as a broken check, not as a wrong password", async () => {
    // 1385 = logon type not granted: a policy problem nobody can fix by retyping.
    mockSafeExecPs1.mockResolvedValue({ stdout: "ERROR 1385", stderr: "" });

    const outcome = await verifier.verify("whatever");
    expect(outcome.status).toBe("error");
    expect((outcome as { message: string }).message).toContain("1385");
  });

  it("reports a PowerShell that produced nothing as a broken check", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "", stderr: "File not found" });

    const outcome = await verifier.verify("test");
    expect(outcome.status).toBe("error");
    expect((outcome as { message: string }).message).toContain("no output");
  });

  it("passes the account and password as environment variables", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    await verifier.verify("s3cr3t$p@ss");

    expect(mockSafeExecPs1).toHaveBeenCalledWith(
      expect.stringContaining("validatePassword.ps1"),
      expect.objectContaining({
        env: { SM_USERNAME: "Yaroslav", SM_DOMAIN: "YHOST", SM_PASSWORD: "s3cr3t$p@ss" },
      }),
    );
  });

  it("sends no domain for a UPN so LogonUser resolves the name itself", async () => {
    process.env.AUTH_USER = "Yaroslav@corp.example";
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    await verifier.verify("s3cr3t");

    expect(mockSafeExecPs1.mock.calls[0][1].env).toMatchObject({
      SM_USERNAME: "Yaroslav@corp.example",
      SM_DOMAIN: "",
    });
  });

  it("refuses to check anything when the service account is all it has", async () => {
    delete process.env.AUTH_USER;
    fakeUser = "SYSTEM";

    const outcome = await verifier.verify("correct-password-of-the-operator");

    expect(outcome.status).toBe("error");
    expect((outcome as { message: string }).message).toContain("AUTH_USER");
    expect(mockSafeExecPs1).not.toHaveBeenCalled();
  });

  it("uses safeExecPs1 (file-based) not safeExec (inline)", async () => {
    mockSafeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });
    await verifier.verify("test");
    expect(mockSafeExecPs1).toHaveBeenCalledTimes(1);
  });
});
