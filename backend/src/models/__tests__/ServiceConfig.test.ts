import {
  ServiceConfig,
  buildEnvironmentLines,
  buildExecStart,
  parseConfigFile,
  serializeConfig,
} from "../ServiceConfig";

describe("parseConfigFile", () => {
  it("parses env.KEY=VALUE lines into environment", () => {
    const raw = `type=generic
command=/usr/bin/python3
env.HF_HOME=/data/huggingface
--port 8080
env.CUDA_VISIBLE_DEVICES=0,1
`;

    const cfg = parseConfigFile("my-service", raw);

    expect(cfg.type).toBe("generic");
    expect(cfg.command).toBe("/usr/bin/python3");
    expect(cfg.flags).toEqual(["--port 8080"]);
    expect(cfg.environment).toEqual({
      HF_HOME: "/data/huggingface",
      CUDA_VISIBLE_DEVICES: "0,1",
    });
  });

  it("yields undefined environment when no env lines present (backward compat)", () => {
    const raw = `type=generic
command=/usr/bin/python3
--port 8080
`;

    const cfg = parseConfigFile("old-service", raw);

    expect(cfg.environment).toBeUndefined();
    expect(cfg.flags).toEqual(["--port 8080"]);
  });

  it("allows '=' inside env values and skips malformed env lines", () => {
    const raw = `command=/usr/bin/python3
env.MY_URL=https://host/path?a=b
env.=broken
env.2BAD=digit-first
env.OK=
--flag
`;

    const cfg = parseConfigFile("env-service", raw);

    expect(cfg.environment).toEqual({ MY_URL: "https://host/path?a=b", OK: "" });
    expect(cfg.flags).toEqual(["--flag"]);
  });

  it("parses unit.user, unit.group and unit.restart metadata lines", () => {
    const raw = `command=/usr/bin/python3
unit.user=llama
unit.group=ai
unit.restart=on-failure
--port 8080
`;

    const cfg = parseConfigFile("svc", raw);

    expect(cfg.user).toBe("llama");
    expect(cfg.group).toBe("ai");
    expect(cfg.restart).toBe("on-failure");
    expect(cfg.flags).toEqual(["--port 8080"]);
  });

  it("treats bare user/group/restart lines as CLI flags, not metadata", () => {
    const raw = `command=/usr/bin/python3
user=llama
group=ai
restart=always
--port 8080
`;

    const cfg = parseConfigFile("svc", raw);

    expect(cfg.user).toBeUndefined();
    expect(cfg.group).toBeUndefined();
    expect(cfg.restart).toBeUndefined();
    expect(cfg.flags).toEqual(["user=llama", "group=ai", "restart=always", "--port 8080"]);
  });

  it("ignores invalid user, group and restart values", () => {
    const raw = `command=/usr/bin/python3
user=1bad user
group=bad group!
restart=sometimes
--flag
`;

    const cfg = parseConfigFile("svc", raw);

    expect(cfg.user).toBeUndefined();
    expect(cfg.group).toBeUndefined();
    expect(cfg.restart).toBeUndefined();
  });
});

describe("serializeConfig", () => {
  it("round-trips environment variables", () => {
    const original: ServiceConfig = {
      name: "svc",
      type: "generic",
      command: "/usr/bin/python3",
      flags: ["--port 8080"],
      environment: { HF_HOME: "/data/huggingface", CUDA_VISIBLE_DEVICES: "0,1" },
    };

    const reparsed = parseConfigFile(original.name, serializeConfig(original));

    expect(reparsed).toEqual(original);
  });

  it("skips invalid env keys and newline-containing values when writing", () => {
    const original: ServiceConfig = {
      name: "svc",
      command: "/usr/bin/python3",
      flags: [],
      environment: { "BAD-KEY": "x", OK: "line1\nline2" },
    };

    const raw = serializeConfig(original);

    expect(raw).not.toContain("env.BAD-KEY=");
    expect(raw).not.toContain("env.OK=");
    expect(raw).toBe("command=/usr/bin/python3\n");
  });

  it("orders metadata, env lines, then flags", () => {
    const original: ServiceConfig = {
      name: "svc",
      type: "generic",
      command: "/usr/bin/python3",
      flags: ["--verbose"],
      environment: { A: "1" },
    };

    expect(serializeConfig(original)).toBe("type=generic\ncommand=/usr/bin/python3\nenv.A=1\n--verbose\n");
  });

  it("round-trips user, group and restart", () => {
    const original: ServiceConfig = {
      name: "svc",
      type: "generic",
      command: "/usr/bin/python3",
      flags: ["--port 8080"],
      user: "llama",
      group: "ai",
      restart: "always",
    };

    const reparsed = parseConfigFile(original.name, serializeConfig(original));

    expect(reparsed).toEqual(original);
  });

  it("omits invalid user/group and unknown restart values when writing", () => {
    const original = {
      name: "svc",
      command: "/usr/bin/python3",
      flags: [],
      user: "bad user",
      group: "",
      restart: "sometimes" as unknown as ServiceConfig["restart"],
    };

    expect(serializeConfig(original)).toBe("command=/usr/bin/python3\n");
  });
});

describe("buildEnvironmentLines", () => {
  it("renders systemd Environment= lines with quoting and escaping", () => {
    const lines = buildEnvironmentLines({
      SIMPLE: "plain",
      PATH_VAL: "/opt/bin:/usr/bin",
      QUOTED: 'say "hi"',
      PERCENT: "50%",
      BACKSLASH: "C:\\temp\\dir",
    });

    expect(lines).toEqual([
      'Environment=SIMPLE="plain"',
      'Environment=PATH_VAL="/opt/bin:/usr/bin"',
      'Environment=QUOTED="say \\"hi\\""',
      'Environment=PERCENT="50%%"',
      'Environment=BACKSLASH="C:\\\\temp\\\\dir"',
    ]);
  });

  it("filters out invalid variable names", () => {
    const lines = buildEnvironmentLines({ "1BAD": "x", "with-dash": "y", OK_VAR: "z" });

    expect(lines).toEqual(['Environment=OK_VAR="z"']);
  });
});

describe("buildExecStart", () => {
  it("is unaffected by environment", () => {
    const cfg: ServiceConfig = {
      name: "svc",
      command: "/usr/bin/python3",
      flags: ["--port", "8080"],
      environment: { A: "1" },
    };

    expect(buildExecStart(cfg)).toBe("/usr/bin/python3 --port 8080");
  });
});