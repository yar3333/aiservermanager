let fakeUser = "operator";

jest.mock("os", () => ({
  userInfo: () => ({ username: fakeUser }),
  hostname: () => "workstation",
}));

// The addon is an optionalDependency built only on Linux, so it is absent here.
const mockAuthenticate = jest.fn();
jest.mock("authenticate-pam", () => ({ authenticate: mockAuthenticate }), { virtual: true });

import { LinuxPasswordVerifier } from "../linuxPasswordVerifier";

const ORIGINAL_AUTH_USER = process.env.AUTH_USER;

beforeEach(() => {
  mockAuthenticate.mockReset();
  fakeUser = "operator";
  process.env.AUTH_USER = "yan";
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterAll(() => {
  process.env.AUTH_USER = ORIGINAL_AUTH_USER;
});

/** PAM reports through a callback; make it answer with what the test needs. */
function pamAnswers(err: Error | null): void {
  mockAuthenticate.mockImplementation(
    (_user: string, _password: string, callback: (e: Error | null, info: unknown) => void) => {
      callback(err, {});
    },
  );
}

describe("LinuxPasswordVerifier", () => {
  const verifier = new LinuxPasswordVerifier();

  it("checks the configured account through the login PAM service", async () => {
    pamAnswers(null);

    expect(await verifier.verify("secret")).toEqual({ status: "ok" });
    expect(mockAuthenticate).toHaveBeenCalledWith("yan", "secret", expect.any(Function), { serviceName: "login" });
  });

  it("reports a PAM rejection as a wrong password", async () => {
    pamAnswers(new Error("Permission denied"));

    expect(await verifier.verify("wrong")).toMatchObject({ status: "denied", detail: "Permission denied" });
  });

  it("falls back to the account running the backend when AUTH_USER is unset", async () => {
    delete process.env.AUTH_USER;
    fakeUser = "root";
    pamAnswers(null);

    await verifier.verify("secret");
    expect(mockAuthenticate).toHaveBeenCalledWith("root", "secret", expect.any(Function), { serviceName: "login" });
  });

  it("refuses to guess when AUTH_USER is malformed", async () => {
    process.env.AUTH_USER = "\\yan";

    const outcome = await verifier.verify("secret");
    expect(outcome.status).toBe("error");
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
