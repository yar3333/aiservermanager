import * as fs from "fs";
import { ExecTools } from "../../../helpers/ExecTools";
import { SystemctlController } from "../systemctlController";

jest.mock("fs");
jest.mock("../../../helpers/ExecTools");

// fs.writeFileSync is overloaded, so the calls are read through a plain mock.
const writeFileSync = fs.writeFileSync as unknown as jest.Mock;
const mockedExec = ExecTools as unknown as {
  safeExec: jest.Mock;
  safeExecWithCode: jest.Mock;
};

/** Unit file content handed to the last write. */
function writtenUnit(): string {
  const call = writeFileSync.mock.calls.at(-1);
  return call ? String(call[1]) : "";
}

describe("SystemctlController install run-as user", () => {
  let controller: SystemctlController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SystemctlController();
    mockedExec.safeExecWithCode.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    mockedExec.safeExec.mockImplementation(async (cmd: string) => ({
      stdout: cmd.includes("list-unit-files") ? "comfyui.service enabled" : "",
      stderr: "",
    }));
  });

  it("writes User= for a name systemd can resolve", async () => {
    const status = await controller.install("comfyui", "/bin/run.sh", { user: "yar" });

    expect(status.error).toBeUndefined();
    expect(writtenUnit()).toContain("User=yar");
  });

  it("leaves the unit without User= when no account was asked for", async () => {
    const status = await controller.install("comfyui", "/bin/run.sh", {});

    expect(status.error).toBeUndefined();
    expect(writtenUnit()).not.toContain("User=");
  });

  it("refuses a windows-style account instead of writing a unit that runs as root", async () => {
    for (const user of [".\\yar", "HOST\\yar", "yar@corp.example"]) {
      const status = await controller.install("comfyui", "/bin/run.sh", { user });

      expect(status.installed).toBe(false);
      expect(status.error).toContain(user);
      expect(status.error).toContain("root");
    }

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(mockedExec.safeExecWithCode).not.toHaveBeenCalled();
  });
});
