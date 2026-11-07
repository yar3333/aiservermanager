import * as os from "os";
import { homeDirectory } from "../homeDirectory";

describe("homeDirectory", () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("uses HOME when a shell set it", () => {
    process.env.HOME = "/home/yan";
    expect(homeDirectory()).toBe("/home/yan");
  });

  it("falls back to the OS profile when HOME is missing — Windows never sets it", () => {
    delete process.env.HOME;
    expect(homeDirectory()).toBe(os.homedir());
  });

  it("ignores a blank HOME instead of resolving paths against the working directory", () => {
    process.env.HOME = "   ";
    expect(homeDirectory()).toBe(os.homedir());
  });
});
