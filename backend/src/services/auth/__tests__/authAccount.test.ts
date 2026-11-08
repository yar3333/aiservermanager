let fakeUser = "operator";

jest.mock("os", () => ({
  userInfo: () => ({ username: fakeUser }),
  hostname: () => "WORKSTATION",
}));

import { parseAuthAccount, resolveAuthAccount } from "../authAccount";

afterEach(() => {
  fakeUser = "operator";
});

describe("parseAuthAccount", () => {
  it("treats a bare name as a local account, named explicitly", () => {
    expect(parseAuthAccount("Yaroslav", "YHOST")).toEqual({ account: { user: "Yaroslav", domain: "YHOST" } });
  });

  it("expands the .\\ shorthand the way the service account field means it", () => {
    expect(parseAuthAccount(".\\Yaroslav", "YHOST")).toEqual({ account: { user: "Yaroslav", domain: "YHOST" } });
  });

  it("keeps an explicit domain", () => {
    expect(parseAuthAccount("CORP\\Yaroslav", "YHOST")).toEqual({
      account: { user: "Yaroslav", domain: "CORP" },
    });
  });

  it("passes a UPN through without a domain, which LogonUser resolves from the name", () => {
    expect(parseAuthAccount("Yaroslav@corp.example", "YHOST")).toEqual({
      account: { user: "Yaroslav@corp.example" },
    });
  });

  it("refuses names with nothing on one side of the backslash", () => {
    expect(parseAuthAccount("\\Yaroslav", "YHOST").error).toContain("no domain before the backslash");
    expect(parseAuthAccount("YHOST\\", "YHOST").error).toContain("no account name after the backslash");
    expect(parseAuthAccount("   ", "YHOST").error).toContain("empty");
  });
});

describe("resolveAuthAccount", () => {
  it("prefers AUTH_USER over whoever runs the process", () => {
    fakeUser = "system";
    const resolved = resolveAuthAccount({ AUTH_USER: "Yaroslav", COMPUTERNAME: "YHOST" }, "win32");

    expect(resolved).toEqual({ account: { user: "Yaroslav", domain: "YHOST" }, source: "env" });
  });

  it("falls back to the process user in the foreground, where that is the operator", () => {
    expect(resolveAuthAccount({}, "linux")).toEqual({ account: { user: "operator" }, source: "process" });
  });

  it("refuses a Windows service account instead of checking a password nobody has", () => {
    fakeUser = "SYSTEM";
    const resolved = resolveAuthAccount({ COMPUTERNAME: "YHOST" }, "win32");

    expect("error" in resolved).toBe(true);
    expect((resolved as { error: string }).error).toContain("AUTH_USER");
    expect((resolved as { error: string }).error).toContain("SYSTEM");
  });

  it("refuses a machine account the same way", () => {
    fakeUser = "YHOST$";
    expect("error" in resolveAuthAccount({ COMPUTERNAME: "YHOST" }, "win32")).toBe(true);
  });

  it("still lets a Linux backend run as root, whose password is a real login", () => {
    fakeUser = "root";
    expect(resolveAuthAccount({}, "linux")).toEqual({ account: { user: "root" }, source: "process" });
  });

  it("reports a bad AUTH_USER as its own problem, not as a wrong password", () => {
    const resolved = resolveAuthAccount({ AUTH_USER: "\\Yaroslav", COMPUTERNAME: "YHOST" }, "win32");

    expect((resolved as { error: string }).error).toMatch(/^AUTH_USER:/);
  });
});
