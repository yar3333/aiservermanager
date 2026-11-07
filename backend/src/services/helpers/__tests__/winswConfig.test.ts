import {
  buildEnvElements,
  buildExecutableElements,
  buildOnFailureElement,
  buildServiceAccountElements,
  buildStopElements,
  buildStopTimeoutElement,
  buildWinSwXml,
  escapeXmlAttribute,
  escapeXmlText,
  isBatchFile,
  parseServiceAccount,
  resolveWorkingDirectory,
} from "../winswConfig";

describe("isBatchFile", () => {
  it("recognises batch launchers regardless of case", () => {
    expect(isBatchFile("C:\\AiPic\\run_comfy.cmd")).toBe(true);
    expect(isBatchFile("/opt/scripts/start.BAT")).toBe(true);
    expect(isBatchFile("/usr/local/bin/llama-server")).toBe(false);
    expect(isBatchFile("  C:\\tools\\worker.cmd  ")).toBe(true);
  });
});

describe("escapeXmlText / escapeXmlAttribute", () => {
  it("escapes markup characters in text", () => {
    expect(escapeXmlText(`a < b & c > d`)).toBe("a &lt; b &amp; c &gt; d");
  });

  it("additionally escapes quotes for attributes", () => {
    expect(escapeXmlAttribute('path "x" & y')).toBe('path &quot;x&quot; &amp; y');
  });
});

describe("buildOnFailureElement", () => {
  it("leaves a service alone when no restart policy is set", () => {
    expect(buildOnFailureElement()).toBe('<onfailure action="none"/>');
    expect(buildOnFailureElement("no")).toBe('<onfailure action="none"/>');
  });

  it("maps every restart-on value to a WinSW restart action", () => {
    const element = buildOnFailureElement("always");
    expect(element).toContain('action="restart"');
    expect(element).toContain('delay="10 sec"');
    expect(buildOnFailureElement("on-failure")).toBe(element);
  });
});

describe("buildExecutableElements", () => {
  it("launches a plain program directly, joining flag fragments verbatim", () => {
    expect(buildExecutableElements("/opt/llama-server", ["--host 0.0.0.0", "--port 8080"])).toEqual([
      "<executable>/opt/llama-server</executable>",
      "<arguments>--host 0.0.0.0 --port 8080</arguments>",
    ]);
  });

  it("omits <arguments> when the service takes none", () => {
    expect(buildExecutableElements("/opt/llama-server", [])).toEqual(["<executable>/opt/llama-server</executable>"]);
  });

  it("runs a batch launcher through cmd.exe so it can stop its console children", () => {
    const elements = buildExecutableElements("C:\\AiPic\\system\\run_comfy.cmd", ["--port 8188"]);

    expect(elements).toContain("<executable>cmd.exe</executable>");
    expect(elements).toContain('<arguments>/d /c "C:\\AiPic\\system\\run_comfy.cmd" --port 8188</arguments>');
    expect(elements).toContain("<stopparentprocessfirst>true</stopparentprocessfirst>");
  });

  it("escapes XML metacharacters coming from user config", () => {
    const [executable, args] = buildExecutableElements("C:\\a&b<x>\\run.exe", ["--note <1> & <2>"]);

    expect(executable).toBe("<executable>C:\\a&amp;b&lt;x&gt;\\run.exe</executable>");
    expect(args).toBe("<arguments>--note &lt;1&gt; &amp; &lt;2&gt;</arguments>");
  });
});

describe("buildEnvElements", () => {
  it("renders name/value pairs and flattens newlines", () => {
    expect(buildEnvElements({ HF_HOME: "D:\\hf", PATH_EXTRA: "a\nb" })).toEqual([
      '<env name="HF_HOME" value="D:\\hf"/>',
      '<env name="PATH_EXTRA" value="a b"/>',
    ]);
  });

  it("drops names that are not valid variable names", () => {
    expect(buildEnvElements({ "1BAD": "x", "with-dash": "y", OK: "z" })).toEqual(['<env name="OK" value="z"/>']);
  });

  it("returns nothing for an empty or missing environment", () => {
    expect(buildEnvElements()).toEqual([]);
    expect(buildEnvElements({})).toEqual([]);
  });
});

describe("parseServiceAccount", () => {
  it("leaves the service on LocalSystem when no user is set", () => {
    expect(parseServiceAccount()).toEqual({});
    expect(parseServiceAccount("   ", "secret")).toEqual({});
  });

  it("asks for the password instead of registering a half-configured account", () => {
    const result = parseServiceAccount("Yaroslav");

    expect(result.account).toBeUndefined();
    expect(result.error).toContain("requires its password");
    expect(result.error).toContain("Yaroslav");
  });

  it("treats a bare name as a local account so a wrong domain cannot slip through", () => {
    expect(parseServiceAccount("Yaroslav", "s3cret")).toEqual({
      account: { domain: ".", user: "Yaroslav", password: "s3cret" },
    });
  });

  it("splits a DOMAIN\\name account", () => {
    expect(parseServiceAccount("ynote2\\Yaroslav", "s3cret")).toEqual({
      account: { domain: "ynote2", user: "Yaroslav", password: "s3cret" },
    });
    expect(parseServiceAccount(".\\svc-ai", "s3cret")).toEqual({
      account: { domain: ".", user: "svc-ai", password: "s3cret" },
    });
  });

  it("passes a UPN through without a domain", () => {
    expect(parseServiceAccount("ai@corp.example", "s3cret")).toEqual({
      account: { user: "ai@corp.example", password: "s3cret" },
    });
  });
});

describe("buildServiceAccountElements", () => {
  it("returns nothing for LocalSystem", () => {
    expect(buildServiceAccountElements()).toEqual([]);
  });

  it("writes the account and its password", () => {
    expect(buildServiceAccountElements({ domain: "ynote2", user: "Yaroslav", password: "s3cret" })).toEqual([
      "<serviceaccount>",
      "  <domain>ynote2</domain>",
      "  <user>Yaroslav</user>",
      "  <password>s3cret</password>",
      "</serviceaccount>",
    ]);
  });

  it("leaves the password out of the file written after registration", () => {
    const lines = buildServiceAccountElements({ domain: "ynote2", user: "Yaroslav", password: "" });

    expect(lines).toEqual(["<serviceaccount>", "  <domain>ynote2</domain>", "  <user>Yaroslav</user>", "</serviceaccount>"]);
    expect(lines.join("\n")).not.toContain("password");
  });

  it("omits <domain> for a UPN and escapes markup in both values", () => {
    const lines = buildServiceAccountElements({ user: "a&b@example", password: "p<x>&ss" });

    expect(lines).not.toContain("  <domain>.</domain>");
    expect(lines).toContain("  <user>a&amp;b@example</user>");
    expect(lines).toContain("  <password>p&lt;x&gt;&amp;ss</password>");
  });
});

describe("buildStopElements", () => {
  it("returns nothing when the program stops on its own", () => {
    expect(buildStopElements()).toEqual([]);
    expect(buildStopElements("   ")).toEqual([]);
  });

  it("passes the configured program and arguments through unchanged", () => {
    expect(buildStopElements("C:\\tools\\stop-comfy.cmd /fast")).toEqual([
      "<stopexecutable>C:\\tools\\stop-comfy.cmd</stopexecutable>",
      "<stoparguments>/fast</stoparguments>",
    ]);
  });

  it("keeps a quoted program path containing spaces together", () => {
    expect(buildStopElements('"C:\\Program Files\\stop tool\\kill.exe" /tree')).toEqual([
      "<stopexecutable>C:\\Program Files\\stop tool\\kill.exe</stopexecutable>",
      "<stoparguments>/tree</stoparguments>",
    ]);
  });

  it("omits <stoparguments> for a bare program", () => {
    expect(buildStopElements("my-stop.exe")).toEqual(["<stopexecutable>my-stop.exe</stopexecutable>"]);
  });
});

describe("buildStopTimeoutElement", () => {
  it("shortens the stop wait of a batch launcher, which cannot answer cmd's prompt", () => {
    expect(buildStopTimeoutElement("C:\\AiPic\\system\\run_comfy.cmd")).toEqual(["<stoptimeout>5 sec</stoptimeout>"]);
    expect(buildStopTimeoutElement("C:\\AiPic\\system\\run_comfy.BAT")).toEqual(["<stoptimeout>5 sec</stoptimeout>"]);
  });

  it("gives a program that stops on its own WinSW's own window", () => {
    expect(buildStopTimeoutElement("C:\\bin\\llama-server.exe")).toEqual([]);
    expect(buildStopTimeoutElement()).toEqual([]);
  });

  it("leaves the full window when a stop command was configured", () => {
    expect(buildStopTimeoutElement("C:\\run_comfy.cmd", "C:\\tools\\stop-comfy.cmd")).toEqual([]);
  });
});

describe("resolveWorkingDirectory", () => {
  it("prefers the configured directory", () => {
    expect(resolveWorkingDirectory("  D:\\work  ", "D:\\ignored\\run.cmd")).toBe("D:\\work");
  });

  it("falls back to the directory holding the program", () => {
    expect(resolveWorkingDirectory(undefined, "C:\\AiPic\\system\\run_comfy.cmd")).toBe("C:\\AiPic\\system");
    expect(resolveWorkingDirectory("   ", "C:\\AiPic\\system\\run_comfy.cmd")).toBe("C:\\AiPic\\system");
  });

  it("uses the current directory for a bare program name", () => {
    expect(resolveWorkingDirectory(undefined, "python.exe")).toBe(process.cwd());
  });
});

describe("buildWinSwXml", () => {
  const spec = {
    id: "comfyui",
    displayName: "comfyui",
    description: "ai server manager service (comfyui)",
    executable: "C:\\AiPic\\system\\run_comfy.cmd",
    args: ["--port", "8188"],
    workingDirectory: "C:\\AiPic\\system",
    logDirectory: "C:\\config\\aiservermanager\\winsw\\comfyui",
  };

  it("produces well-formed XML for the wrapper service", () => {
    const xml = buildWinSwXml(spec);

    expect(xml.startsWith("<service>")).toBe(true);
    expect(xml.trimEnd().endsWith("</service>")).toBe(true);
    expect(xml).toContain("<id>comfyui</id>");
    expect(xml).toContain("<workingdirectory>C:\\AiPic\\system</workingdirectory>");
    expect(xml).toContain("<startmode>Manual</startmode>");
    expect(xml).toContain('<logpath>C:\\config\\aiservermanager\\winsw\\comfyui</logpath>');
    expect(xml).toContain('<log mode="roll-by-size">');
    expect(xml).toContain('<onfailure action="none"/>');
  });

  it("never autostarts on boot, so install() keeps the manual-start contract", () => {
    expect(buildWinSwXml({ ...spec, restart: "always" })).toContain("<startmode>Manual</startmode>");
  });

  it("carries the program, its arguments and the environment", () => {
    const xml = buildWinSwXml({ ...spec, environment: { AG_VIDEO_TYPE: "amd" } });

    expect(xml).toContain("<executable>cmd.exe</executable>");
    expect(xml).toContain('<arguments>/d /c "C:\\AiPic\\system\\run_comfy.cmd" --port 8188</arguments>');
    expect(xml).toContain('<env name="AG_VIDEO_TYPE" value="amd"/>');
  });

  it("writes the run-as account so the service does not land on LocalSystem", () => {
    const xml = buildWinSwXml({
      ...spec,
      serviceAccount: { domain: "ynote2", user: "Yaroslav", password: "s3cret" },
    });

    expect(xml).toContain("<serviceaccount>");
    expect(xml).toContain("  <domain>ynote2</domain>");
    expect(xml).toContain("  <user>Yaroslav</user>");
    expect(xml).toContain("  <password>s3cret</password>");
    expect(xml).toContain("</serviceaccount>");
  });

  it("leaves no serviceaccount element when the user is not set", () => {
    expect(buildWinSwXml(spec)).not.toContain("serviceaccount");
  });

  it("writes the stop command as stopexecutable/stoparguments", () => {
    const xml = buildWinSwXml({ ...spec, stopCommand: "C:\\tools\\stop-comfy.cmd /fast" });

    expect(xml).toContain("<stopexecutable>C:\\tools\\stop-comfy.cmd</stopexecutable>");
    expect(xml).toContain("<stoparguments>/fast</stoparguments>");
  });

  it("gives a batch launcher a short stop wait", () => {
    // cmd.exe answers the stop signal with "Terminate batch job (Y/N)?", which
    // nothing can answer in a service, so waiting the full default is wasted.
    expect(buildWinSwXml(spec)).toContain("<stoptimeout>5 sec</stoptimeout>");
  });

  it("keeps WinSW's own stop wait for a program that stops on its own", () => {
    expect(buildWinSwXml({ ...spec, executable: "C:\\bin\\llama-server.exe" })).not.toContain("stoptimeout");
  });
});
