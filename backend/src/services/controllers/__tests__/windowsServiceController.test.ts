import { ExecTools } from "../../../helpers/ExecTools";
import { ServerIdentity } from "../../../helpers/ServerIdentity";
import { WindowsServiceController } from "../windowsServiceController";

jest.mock("../../../helpers/ExecTools");
jest.mock("../../../helpers/ServerIdentity");

const mockedExec = ExecTools as unknown as {
  safeExecPs1: jest.Mock;
  safeExec: jest.Mock;
  safeExecWithCode: jest.Mock;
};
const mockedPrivilege = ServerIdentity as unknown as { isPrivileged: jest.Mock };

/** Run the private grant step the way install() does. */
function grant(controller: WindowsServiceController, account: { domain?: string; user: string }) {
  return (controller as unknown as { grantLogonRight(a: unknown): Promise<string | undefined> }).grantLogonRight(
    account,
  );
}

/** Verbatim `sc.exe queryex` layout — the field names are padded, the colon is not next to them. */
const QUERYEX_RUNNING = `
SERVICE_NAME: comfyui
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x7d0
        PID                : 4711
        FLAGS              : `;

const QUERYEX_STOPPED = QUERYEX_RUNNING.replace("4  RUNNING", "1  STOPPED").replace("4711", "0");

/** `sc.exe queryex` answers with `queryexOutput`, the start type comes back as `startType`. */
function stubQuery(queryexOutput: string, startType: string): void {
  mockedExec.safeExec.mockImplementation(async (cmd: string) => {
    if (cmd.includes("queryex")) return { stdout: queryexOutput, stderr: "" };
    if (cmd.includes("StartType")) return { stdout: `${startType}\n`, stderr: "" };
    return { stdout: "", stderr: "" };
  });
}

describe("WindowsServiceController logon right", () => {
  let controller: WindowsServiceController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WindowsServiceController();
  });

  it("passes the local machine where the account said '.'", async () => {
    mockedExec.safeExecPs1.mockResolvedValue({ stdout: "OK: granted\n", stderr: "" });
    process.env.COMPUTERNAME = "YNOTE2";

    await expect(grant(controller, { domain: ".", user: "Yaroslav" })).resolves.toBeUndefined();

    const [script, options] = mockedExec.safeExecPs1.mock.calls[0];
    expect(script).toContain("grantLogonServiceRight.ps1");
    expect(options.env).toEqual({ SM_ACCOUNT_DOMAIN: "YNOTE2", SM_ACCOUNT_NAME: "Yaroslav" });
  });

  it("keeps a domain account and a UPN as they are", async () => {
    mockedExec.safeExecPs1.mockResolvedValue({ stdout: "OK\n", stderr: "" });

    await grant(controller, { domain: "corp", user: "svc-llama" });
    expect(mockedExec.safeExecPs1.mock.calls[0][1].env).toEqual({
      SM_ACCOUNT_DOMAIN: "corp",
      SM_ACCOUNT_NAME: "svc-llama",
    });

    await grant(controller, { user: "svc-llama@corp.example" });
    expect(mockedExec.safeExecPs1.mock.calls[1][1].env).toEqual({
      SM_ACCOUNT_DOMAIN: "",
      SM_ACCOUNT_NAME: "svc-llama@corp.example",
    });
  });

  it("reports a failed grant with the script's reason", async () => {
    mockedExec.safeExecPs1.mockResolvedValue({
      stdout: "FAIL: cannot grant SeServiceLogonRight (Win32 error 1314)\n",
      stderr: "",
    });

    const error = await grant(controller, { domain: "YNOTE2", user: "Yaroslav" });

    expect(error).toContain("Win32 error 1314");
    expect(error).toContain("YNOTE2\\Yaroslav");
    expect(error).toContain("Log on as a service");
  });

  it("treats a grant script that never reported success as a failure", async () => {
    mockedExec.safeExecPs1.mockResolvedValue({ stdout: "", stderr: "" });

    await expect(grant(controller, { domain: "YNOTE2", user: "Yaroslav" })).resolves.toContain(
      "Log on as a service",
    );
  });

  it("hands the operator the command that grants the right where privileges allow", async () => {
    // This backend is a service, so "run it elevated" is no help — the error has
    // to carry something that can actually be run, with the account already filled in.
    mockedExec.safeExecPs1.mockResolvedValue({
      stdout: "FAIL: SeServiceLogonRight: LsaEnumerateAccountRights failed (Win32 error 5)\n",
      stderr: "",
    });

    const error = await grant(controller, { domain: "YHOST", user: "Yaroslav" });

    expect(error).toContain("Win32 error 5");
    expect(error).toMatch(
      /powershell -NoProfile -ExecutionPolicy Bypass -File "[^"]*grantLogonServiceRight\.ps1" -Domain "YHOST" -User "Yaroslav"/,
    );
    expect(error).toContain("elevated PowerShell");
    expect(error).toContain("secpol.msc");
  });

  it("sends a UPN as one name, because the script resolves its domain itself", async () => {
    mockedExec.safeExecPs1.mockResolvedValue({ stdout: "", stderr: "" });

    const error = await grant(controller, { user: "svc-llama@corp.example" });

    expect(error).toContain('-User "svc-llama@corp.example"');
    expect(error).not.toContain("-Domain");
  });
});

describe("WindowsServiceController start type", () => {
  let controller: WindowsServiceController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WindowsServiceController();
    mockedPrivilege.isPrivileged.mockResolvedValue(true);
  });

  it("reads the state and the pid out of the padded sc.exe output", async () => {
    stubQuery(QUERYEX_RUNNING, "Manual");

    const status = await controller.getStatus("comfyui");

    expect(status.running).toBe(true);
    expect(status.pid).toBe(4711);
    expect(status.installed).toBe(true);
  });

  it("counts only Automatic as enabled, because Manual never boots on its own", async () => {
    stubQuery(QUERYEX_STOPPED, "Manual");
    await expect(controller.getStatus("comfyui")).resolves.toMatchObject({ enabled: false });

    stubQuery(QUERYEX_STOPPED, "Automatic");
    await expect(controller.getStatus("comfyui")).resolves.toMatchObject({ enabled: true, running: false });
  });

  it("reports no pid for a service whose PID is the sc.exe placeholder 0", async () => {
    stubQuery(QUERYEX_STOPPED, "Manual");

    const status = await controller.getStatus("comfyui");

    expect(status.pid).toBeUndefined();
  });

  it("takes only the autostart away on disable, so the service stays startable", async () => {
    stubQuery(QUERYEX_STOPPED, "Manual");
    mockedExec.safeExecWithCode.mockResolvedValue({ stdout: "[SC] ChangeServiceConfig SUCCESS", stderr: "", exitCode: 0 });

    await controller.perform("comfyui", "disable");

    expect(mockedExec.safeExecWithCode).toHaveBeenCalledWith('sc.exe config "comfyui" start= demand');
  });

  it("sets the start type to auto on enable", async () => {
    stubQuery(QUERYEX_STOPPED, "Automatic");
    mockedExec.safeExecWithCode.mockResolvedValue({ stdout: "[SC] ChangeServiceConfig SUCCESS", stderr: "", exitCode: 0 });

    await controller.perform("comfyui", "enable");

    expect(mockedExec.safeExecWithCode).toHaveBeenCalledWith('sc.exe config "comfyui" start= auto');
  });
});
