import {
  ServiceConfig,
  buildEnvironmentLines,
  buildExecStart,
  buildInstallOptions,
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

  it("recognises the avalon type and writes it back", () => {
    const cfg = parseConfigFile(
      "avalon-qwen",
      `type=avalon
command=/home/yar/MyDocs/AiChat/avalon/run.sh
env.GPUS=ROCm0
`,
    );

    expect(cfg.type).toBe("avalon");
    expect(cfg.environment).toEqual({ GPUS: "ROCm0" });
    expect(serializeConfig(cfg)).toBe(
      "type=avalon\ncommand=/home/yar/MyDocs/AiChat/avalon/run.sh\nenv.GPUS=ROCm0\n",
    );
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

describe("unit.cwd", () => {
  it("parses unit.cwd= as the working directory", () => {
    const cfg = parseConfigFile(
      "svc",
      `command=/usr/bin/python3
unit.cwd=/srv/worker
--flag
`,
    );

    expect(cfg.workingDirectory).toBe("/srv/worker");
    expect(cfg.flags).toEqual(["--flag"]);
  });

  it("keeps Windows paths with spaces intact", () => {
    const cfg = parseConfigFile("svc", "command=C:\\AiPic\\run.cmd\nunit.cwd=C:\\AiPic\\system dir\n");

    expect(cfg.workingDirectory).toBe("C:\\AiPic\\system dir");
  });

  it("treats a bare cwd= line as a CLI flag", () => {
    const cfg = parseConfigFile("svc", "command=/usr/bin/python3\ncwd=/srv/worker\n");

    expect(cfg.workingDirectory).toBeUndefined();
    expect(cfg.flags).toEqual(["cwd=/srv/worker"]);
  });

  it("round-trips the working directory", () => {
    const original: ServiceConfig = {
      name: "svc",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: [],
      workingDirectory: "C:\\AiPic\\system",
    };

    expect(serializeConfig(original)).toBe(
      "command=C:\\AiPic\\run_comfy.cmd\nunit.cwd=C:\\AiPic\\system\n",
    );
    expect(parseConfigFile(original.name, serializeConfig(original))).toEqual(original);
  });
});

describe("buildInstallOptions", () => {
  it("passes the program and its argument fragments separately for non-shell hosts", () => {
    const options = buildInstallOptions({
      name: "svc",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: ["--port 8188"],
      environment: { AG_VIDEO_TYPE: "amd" },
      workingDirectory: "C:\\AiPic\\system",
      restart: "on-failure",
    });

    expect(options.executable).toBe("C:\\AiPic\\run_comfy.cmd");
    expect(options.args).toEqual(["--port 8188"]);
    expect(options.workingDirectory).toBe("C:\\AiPic\\system");
    expect(options.environment).toEqual({ AG_VIDEO_TYPE: "amd" });
    expect(options.restart).toBe("on-failure");
  });

  it("leaves the working directory unset when the config does not set one", () => {
    const options = buildInstallOptions({ name: "svc", command: "/bin/true", flags: [] });

    expect(options.workingDirectory).toBeUndefined();
    expect(options.args).toEqual([]);
  });

  it("carries the run-as password and stop command to the controller", () => {
    const options = buildInstallOptions({
      name: "svc",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: [],
      user: "ynote2\\Yaroslav",
      runAsPassword: "s3cret",
      stopCommand: "C:\\tools\\stop-comfy.cmd /fast",
    });

    expect(options.user).toBe("ynote2\\Yaroslav");
    expect(options.runAsPassword).toBe("s3cret");
    expect(options.stopCommand).toBe("C:\\tools\\stop-comfy.cmd /fast");
  });
});

describe("Windows run-as account and stop command", () => {
  it("accepts a Windows account name", () => {
    const cfg = parseConfigFile(
      "svc",
      `command=C:\\AiPic\\run_comfy.cmd
unit.user=ynote2\\Yaroslav
--port 8188
`,
    );

    expect(cfg.user).toBe("ynote2\\Yaroslav");
    expect(cfg.flags).toEqual(["--port 8188"]);
  });

  it("accepts a local and a UPN account form", () => {
    expect(parseConfigFile("svc", "command=c\nunit.user=.\\svc-ai\n").user).toBe(".\\svc-ai");
    expect(parseConfigFile("svc", "command=c\nunit.user=ai@corp.example\n").user).toBe("ai@corp.example");
  });

  it("rejects an account name with a space or a path separator", () => {
    expect(parseConfigFile("svc", "command=c\nunit.user=Domain Not Work\n").user).toBeUndefined();
    expect(parseConfigFile("svc", "command=c\nunit.user=C:\\evil\\path\n").user).toBeUndefined();
  });

  it("never reads the account password from disk", () => {
    const cfg = parseConfigFile("svc", "command=c\nunit.password=s3cr3t\n--port 8080\n");

    expect(cfg.runAsPassword).toBeUndefined();
    // The key is still recognised, so the line cannot become a CLI argument.
    expect(cfg.flags).toEqual(["--port 8080"]);
  });

  it("never writes the account password to disk", () => {
    const raw = serializeConfig({
      name: "svc",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: [],
      user: "ynote2\\Yaroslav",
      runAsPassword: "s3cr3t",
    });

    expect(raw).toContain("unit.user=ynote2\\Yaroslav");
    expect(raw).not.toContain("s3cr3t");
    expect(raw).not.toContain("unit.password=");
  });

  it("round-trips the account and stop command", () => {
    const original: ServiceConfig = {
      name: "svc",
      command: "C:\\AiPic\\run_comfy.cmd",
      flags: ["--port 8188"],
      user: "ynote2\\Yaroslav",
      stopCommand: "C:\\tools\\stop-comfy.cmd /fast",
    };

    const raw = serializeConfig(original);
    expect(raw).toContain("unit.user=ynote2\\Yaroslav");
    expect(raw).toContain("unit.stop=C:\\tools\\stop-comfy.cmd /fast");
    expect(parseConfigFile(original.name, raw)).toEqual(original);
  });

  it("writes no optional unit lines when they are absent", () => {
    const raw = serializeConfig({ name: "svc", command: "/bin/true", flags: [], user: "llama" });

    expect(raw).toBe("command=/bin/true\nunit.user=llama\n");
  });
});