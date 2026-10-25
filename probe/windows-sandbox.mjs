// Probes sandbox-runtime's Windows sandbox the way Solyx would use it: PowerShell commands, the
// app's folders in the user's profile, one conversation's workspace. Each "deny" check runs once
// outside the sandbox first, so a block is the sandbox's doing.
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  SandboxManager,
  checkWindowsSandboxStatusAsync,
  getWindowsSandboxUserStatusAsync,
  installWindowsSandboxAsync,
  resolveSrtWin,
  uninstallWindowsSandbox,
  VENDORED_SRT_WIN_EXE,
} from "@anthropic-ai/sandbox-runtime";

// srt looks for no helper of its own accord; an app names the binary it ships.
const srtWin = resolveSrtWin({ path: VENDORED_SRT_WIN_EXE });

const PS = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
const profile = homedir();
const userData = join(process.env.APPDATA, "SolyxProbe");
const configDir = join(profile, ".solyx-probe");
const skill = join(configDir, "skills", "notes");
const workspaces = join(userData, "agent-workspaces");
const conv1 = join(workspaces, "conv-1");
const conv2 = join(workspaces, "conv-2");
const conv3 = join(userData, "elsewhere", "conv-3");
const diary = join(profile, "Documents", "solyx-probe-diary.txt");
const sshKey = join(profile, ".ssh", "solyx_probe_key");
const programData = join(process.env.ProgramData, "SolyxProbe");
const blob = join(conv1, "blob.txt");
const summary = [];

const log = (line) => {
  console.log(line);
  summary.push(line);
};

const q = (path) => `'${path.replaceAll("'", "''")}'`;

function run(file, args, options) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = "";
    const child = spawn(file, args, {
      ...options,
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", (error) => (out += `spawn error: ${error.message}`));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        out: out.replace(/\s+/g, " ").trim().slice(0, 240),
        ms: Date.now() - started,
      });
    });
  });
}

// Every command stops at its first error.
const script = (command) => `$ErrorActionPreference='Stop'; ${command}`;

const outside = (command) =>
  run(PS, ["-NoProfile", "-NonInteractive", "-Command", script(command)], {
    cwd: conv1,
    env: process.env,
  });

async function inside(command, custom, cwd = conv1) {
  const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
    script(command),
    "powershell",
    custom,
    undefined,
    cwd
  );

  return run(argv[0], argv.slice(1), { cwd, env });
}

async function step(name, fn) {
  const started = Date.now();

  try {
    const value = await fn();
    log(
      `- ✅ **${name}** (${Date.now() - started} ms)${value === undefined ? "" : `: \`${JSON.stringify(value).slice(0, 600)}\``}`
    );
    return value;
  } catch (error) {
    log(
      `- ❌ **${name}** (${Date.now() - started} ms): \`${String(
        error?.message ?? error
      )
        .replace(/\s+/g, " ")
        .slice(0, 600)}\``
    );
    return undefined;
  }
}

// Each conversation's command denies the other conversations, since Windows takes allows only per session.
const perExec = (extra = []) => ({
  filesystem: {
    denyRead: [conv2, ...extra],
    allowWrite: [],
    denyWrite: [conv2],
  },
});

/**
 * Runs `command` inside the sandbox, and for a "deny" check first outside it (`outsideCommand`
 * where the two must differ). `leak` reads a leak from the output instead of the exit code.
 */
async function check(name, expect, command, options = {}) {
  const base =
    expect === "allow" || expect === "info"
      ? undefined
      : await outside(options.outsideCommand ?? command);
  let got;

  try {
    got = await inside(command, options.custom ?? perExec());
  } catch (error) {
    got = {
      code: "wrap threw",
      out: String(error?.message ?? error).slice(0, 240),
      ms: 0,
    };
  }

  const leaked = options.leak ? options.leak(got.out) : got.code === 0;
  const verdict =
    expect === "info"
      ? "INFO"
      : expect === "allow"
        ? got.code === 0
          ? "PASS"
          : "FAIL"
        : !options.leak && base.code !== 0
          ? "N/A (fails outside too)"
          : leaked
            ? "FAIL (leaked)"
            : "PASS";

  log(
    `| ${verdict} | ${name} | ${base ? `${base.code}: ${base.out.replaceAll("|", "/")}` : "-"} | ${got.code} (${got.ms} ms): ${got.out.replaceAll("|", "/")} |`
  );
}

function fixtures() {
  for (const folder of [
    join(userData, "secrets"),
    conv1,
    conv2,
    conv3,
    skill,
    join(profile, "Documents"),
    join(profile, ".ssh"),
    programData,
  ])
    mkdirSync(folder, { recursive: true });
  writeFileSync(join(userData, "secrets", "broker.bin"), "sealed-secret");
  writeFileSync(join(conv2, "note.txt"), "other-conversation");
  writeFileSync(join(configDir, "config.json"), "config-secret");
  writeFileSync(join(skill, "SKILL.md"), "skill-body");
  writeFileSync(diary, "diary-secret");
  writeFileSync(sshKey, "ssh-secret");
  writeFileSync(join(programData, "public.txt"), "programdata-readable");
  process.env.SOLYX_PROBE_SECRET = "env-secret";
}

const policy = (writeRoots) => ({
  windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } },
  network: { allowedDomains: [], deniedDomains: [] },
  filesystem: {
    denyRead: [],
    allowRead: [skill],
    allowWrite: writeRoots,
    denyWrite: [],
  },
});

const sleeper = () =>
  spawn(PS, ["-NoProfile", "-Command", "Start-Sleep 600"], {
    windowsHide: true,
  });

const alive = (child) => child.exitCode === null && child.signalCode === null;

async function checks() {
  log("\n### Checks\n");
  log("| verdict | check | outside | inside |");
  log("|---|---|---|---|");

  const sid = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], {
    encoding: "utf8",
  })
    .stdout.trim()
    .split(",")
    .at(-1)
    .replaceAll('"', "");
  spawnSync("reg", [
    "add",
    "HKCU\\Software\\SolyxProbe",
    "/v",
    "secret",
    "/d",
    "reg-secret",
    "/f",
  ]);
  await outside(
    `Add-Type -AssemblyName System.Security; [IO.File]::WriteAllText(${q(blob)}, [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('dpapi-secret'), $null, 'CurrentUser')))`
  );

  const forOutside = sleeper();
  const forInside = sleeper();
  const server = createServer((_req, res) => res.end("served"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const unique = "([guid]::NewGuid().ToString())";

  await check("whoami", "info", "whoami");
  await check("starting location", "info", "(Get-Location).Path");
  await check(
    "enter its workspace",
    "allow",
    `Set-Location -LiteralPath ${q(conv1)}; (Get-Location).Path`
  );
  await check(
    "read the app's sealed secret",
    "deny",
    `Get-Content -Raw -LiteralPath ${q(join(userData, "secrets", "broker.bin"))}`
  );
  await check(
    "read another conversation",
    "deny",
    `Get-Content -Raw -LiteralPath ${q(join(conv2, "note.txt"))}`
  );
  await check(
    "write in another conversation",
    "deny",
    `Set-Content -LiteralPath (Join-Path ${q(conv2)} ${unique}) -Value x`
  );
  await check(
    "read the app's config",
    "deny",
    `Get-Content -Raw -LiteralPath ${q(join(configDir, "config.json"))}`
  );
  await check(
    "read Documents",
    "deny",
    `Get-Content -Raw -LiteralPath ${q(diary)}`
  );
  await check(
    "read ~/.ssh",
    "deny",
    `Get-Content -Raw -LiteralPath ${q(sshKey)}`
  );
  await check(
    "list the profile",
    "deny",
    `Get-ChildItem -Force -LiteralPath ${q(profile)} | Out-Null; 'listed'`
  );
  await check(
    "read the skill offered",
    "allow",
    `Get-Content -Raw -LiteralPath ${q(join(skill, "SKILL.md"))}`
  );
  await check(
    "write and read back in its workspace",
    "allow",
    `Set-Content -LiteralPath ${q(join(conv1, "out.txt"))} -Value ok; Get-Content -LiteralPath ${q(join(conv1, "out.txt"))}`
  );
  await check(
    "write in the profile",
    "deny",
    `Set-Content -LiteralPath (Join-Path ${q(profile)} ${unique}) -Value x`
  );
  await check(
    "write in ProgramData",
    "deny",
    `Set-Content -LiteralPath (Join-Path $env:ProgramData ${unique}) -Value x`
  );
  await check(
    "write in Users\\Public",
    "deny",
    `Set-Content -LiteralPath (Join-Path 'C:\\Users\\Public' ${unique}) -Value x`
  );
  await check(
    "make a folder at C:\\",
    "deny",
    `New-Item -ItemType Directory -Path (Join-Path 'C:\\' ('solyx-escape-' + ${unique})) | Out-Null; 'made'`
  );
  await check(
    "read a file Users may read (ProgramData)",
    "info",
    `Get-Content -Raw -LiteralPath ${q(join(programData, "public.txt"))}`
  );
  await check(
    "read that file under a per-command deny",
    "deny",
    `Get-Content -Raw -LiteralPath ${q(join(programData, "public.txt"))}`,
    {
      custom: perExec([programData]),
    }
  );
  await check(
    "unseal the user's DPAPI blob",
    "deny",
    `Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String((Get-Content -Raw -LiteralPath ${q(blob)}).Trim()), $null, 'CurrentUser'))`
  );
  await check(
    "read the user's HKCU",
    "deny",
    `(Get-ItemProperty -LiteralPath 'Registry::HKEY_USERS\\${sid}\\Software\\SolyxProbe').secret`
  );
  await check(
    "stop a process of the user",
    "deny",
    `Stop-Process -Id ${forInside.pid} -Force; 'stopped'`,
    {
      outsideCommand: `Stop-Process -Id ${forOutside.pid} -Force; 'stopped'`,
    }
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  log(`|  | its target still alive after | | ${alive(forInside)} |`);
  await check(
    "see the app's environment",
    "deny",
    `"[$env:SOLYX_PROBE_SECRET]"`,
    {
      leak: (out) => out.includes("env-secret"),
    }
  );
  await check(
    "raw TCP to 1.1.1.1:443",
    "deny",
    `$c = New-Object Net.Sockets.TcpClient; $c.Connect('1.1.1.1', 443); 'connected'`
  );
  await check(
    "loopback TCP to a local server",
    "deny",
    `$c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', ${port}); 'connected'`
  );
  await check(
    "DNS lookup",
    "deny",
    `[Net.Dns]::GetHostAddresses('example.com') | Select-Object -First 1 | ForEach-Object { $_.ToString() }`
  );
  await check(
    "curl.exe https (Schannel)",
    "info",
    `curl.exe -sS -m 10 -o NUL -w '%{http_code}' https://example.com`
  );
  await check(
    "node fetch https",
    "deny",
    `node -e "fetch('https://example.com').then(r=>{console.log(r.status);process.exit(0)},e=>{console.error(e.cause?.code??e.message);process.exit(1)})"`
  );
  await check(
    "python runs",
    "info",
    `python -c "import sys; print(sys.version.split()[0])"`
  );
  await check(
    "USERPROFILE / TEMP inside",
    "info",
    `"$env:USERPROFILE | $env:TEMP"`
  );

  const times = { outside: [], inside: [] };
  for (let i = 0; i < 5; i++) {
    times.outside.push((await outside("exit 0")).ms);
    times.inside.push((await inside("exit 0", perExec())).ms);
  }
  const median = (xs) => xs.sort((a, b) => a - b)[2];
  log(
    `\nLatency of \`exit 0\` through PowerShell: outside ${median(times.outside)} ms, inside ${median(times.inside)} ms (median of 5).`
  );

  forOutside.kill();
  forInside.kill();
  server.close();
}

/** Why a command cannot enter a workspace under %APPDATA%: the ACL of every folder above it, and other places. */
async function cwdDiagnosis() {
  log("\n### Entering a workspace\n");

  const chain = [];
  for (let path = conv1; path.length > 3; path = join(path, ".."))
    chain.push(path);
  for (const path of chain.reverse()) {
    const acl = spawnSync("icacls", [path], { encoding: "utf8" })
      .stdout.replace(/\s+/g, " ")
      .replace("Successfully processed 1 files; Failed processing 0 files", "")
      .trim();
    const attributes = spawnSync(
      PS,
      [
        "-NoProfile",
        "-Command",
        `(Get-Item -Force -LiteralPath ${q(path)}).Attributes`,
      ],
      { encoding: "utf8" }
    ).stdout.trim();
    log(
      `- \`${path}\` [${attributes}]: ${acl.slice(path.length).trim().slice(0, 700)}`
    );
  }

  const roots = [
    ["%APPDATA%", join(process.env.APPDATA, "SolyxCwd", "agent-workspaces")],
    [
      "%LOCALAPPDATA%",
      join(process.env.LOCALAPPDATA, "SolyxCwd", "agent-workspaces"),
    ],
    ["profile", join(profile, "SolyxCwd", "agent-workspaces")],
  ];
  log(
    "\n| root | starting location | Set-Location | cmd cd, then Windows PowerShell | pwsh 7 |"
  );
  log("|---|---|---|---|---|");

  for (const [label, root] of roots) {
    const conversation = join(root, "conv");
    mkdirSync(conversation, { recursive: true });
    await SandboxManager.reset();
    await SandboxManager.initialize(policy([root]));
    const cell = async (command) => {
      const r = await inside(command, undefined, conversation).catch(
        (error) => ({ code: "threw", out: String(error.message) })
      );
      return `${r.code}: ${r.out.slice(0, 80).replaceAll("|", "/")}`;
    };
    // Each in its own shell, run as srt hands it to that shell.
    const shell = async (binShell, command) => {
      const r = await SandboxManager.wrapWithSandboxArgv(
        command,
        binShell,
        undefined,
        undefined,
        conversation
      )
        .then(({ argv, env }) =>
          run(argv[0], argv.slice(1), { cwd: conversation, env })
        )
        .catch((error) => ({ code: "threw", out: String(error.message) }));
      return `${r.code}: ${r.out.slice(0, 120).replaceAll("|", "/")}`;
    };
    const relative =
      "(Get-Location).Path; Set-Content -LiteralPath rel.txt -Value ok; Get-Content -LiteralPath rel.txt";
    log(
      `| ${label} | ${await cell("(Get-Location).Path")} | ${await cell(`Set-Location -LiteralPath ${q(conversation)}; 'ok'`)} | ${await shell("cmd", `cd /d "${conversation}" && "${PS}" -NoProfile -NonInteractive -Command "${relative}"`)} | ${await shell("pwsh", `Set-Location -LiteralPath ${q(conversation)}; ${relative}`)} |`
    );
  }

  await SandboxManager.reset();
}

/** Where a write root may sit, and whether a command in it can enter, write and read back. */
async function workspaceMatrix() {
  log("\n### Where the write root sits\n");
  log(
    "| root | per-command denies | enter + write + read back | absolute write + read back | list the root | starting location |"
  );
  log("|---|---|---|---|---|---|");

  const roots = [
    ["under a read-denied folder", workspaces],
    ["in the profile", join(profile, "solyx-ws")],
    ["outside the profile", "C:\\solyx-ws"],
  ];
  const attempt = (command, custom, cwd) =>
    inside(command, custom, cwd).catch((error) => ({
      code: "threw",
      out: String(error.message),
    }));
  const cell = (r) => `${r.code}: ${r.out.slice(0, 90).replaceAll("|", "/")}`;
  const acl = (path) =>
    spawnSync("icacls", [path], { encoding: "utf8" })
      .stdout.replace(/\s+/g, " ")
      .trim()
      .slice(0, 900);

  for (const [label, root] of roots) {
    const conversation = join(root, "conv-m");
    const sibling = join(root, "conv-s");
    mkdirSync(conversation, { recursive: true });
    mkdirSync(sibling, { recursive: true });

    await SandboxManager.reset();
    const started = Date.now();
    await SandboxManager.initialize(policy([root]));
    const initMs = Date.now() - started;

    for (const denies of [false, true]) {
      const custom = denies
        ? {
            filesystem: {
              denyRead: [sibling],
              allowWrite: [],
              denyWrite: [sibling],
            },
          }
        : undefined;
      const file = join(conversation, `m-${denies}.txt`);
      const enter = await attempt(
        `Set-Location -LiteralPath ${q(conversation)}; Set-Content -LiteralPath e.txt -Value ok; Get-Content e.txt`,
        custom,
        conversation
      );
      const absolute = await attempt(
        `Set-Content -LiteralPath ${q(file)} -Value ok; Get-Content -LiteralPath ${q(file)}`,
        custom,
        conversation
      );
      const list = await attempt(
        `Get-ChildItem -LiteralPath ${q(root)} | Out-Null; 'listed'`,
        custom,
        conversation
      );
      const where = await attempt("(Get-Location).Path", custom, conversation);
      log(
        `| ${label} (init ${initMs} ms) | ${denies} | ${cell(enter)} | ${cell(absolute)} | ${cell(list)} | ${cell(where)} |`
      );
    }

    log(`\n\`icacls ${root}\`: ${acl(root)}\n`);
    log(`\`icacls ${conversation}\`: ${acl(conversation)}\n`);
  }

  await SandboxManager.reset();
}

/** Ways to let Windows PowerShell work in a workspace whose folders above it the sandbox cannot read. */
async function candidates() {
  log("\n### Entering a workspace: candidate fixes\n");
  log(
    "| candidate | starting location | Set-Location | relative write + read | native child's cwd | python's cwd |"
  );
  log("|---|---|---|---|---|---|");

  const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
  const group = "sandbox-runtime-users";
  const ancestors = [
    profile,
    join(profile, "AppData"),
    process.env.APPDATA,
    userData,
  ];
  const junctionParent = join(process.env.ProgramData, "SolyxJ");
  const junction = join(junctionParent, "conv");
  const dataRoot = join(programData, "ws");
  const dataConv = join(dataRoot, "conv");
  mkdirSync(dataConv, { recursive: true });

  const shellRun = async (binShell, command, cwd) => {
    const r = await SandboxManager.wrapWithSandboxArgv(
      `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ${command}`,
      binShell,
      undefined,
      undefined,
      cwd
    )
      .then(({ argv, env }) => run(argv[0], argv.slice(1), { cwd, env }))
      .catch((error) => ({ code: "threw", out: String(error.message) }));
    return `${r.code}: ${r.out.slice(0, 110).replaceAll("|", "/")}`;
  };

  // `enter` is the PowerShell that brings a command to the workspace; `cwd` is where it is spawned.
  const row = async (label, { binShell = "powershell", root, cwd, enter }) => {
    await SandboxManager.reset();
    await SandboxManager.initialize(policy([root]));
    const cells = [
      await shellRun(binShell, "(Get-Location).Path", cwd),
      await shellRun(binShell, `${enter}; (Get-Location).Path`, cwd),
      await shellRun(
        binShell,
        `${enter}; Set-Content -LiteralPath rel.txt -Value ok; Get-Content -LiteralPath rel.txt`,
        cwd
      ),
      await shellRun(binShell, `${enter}; cmd /d /c cd`, cwd),
      await shellRun(
        binShell,
        `${enter}; python -c "import os; print(os.getcwd())"`,
        cwd
      ),
    ];
    log(`| ${label} | ${cells.join(" | ")} |`);
  };

  const enterConv1 = `Set-Location -LiteralPath ${q(conv1)}`;

  await row("baseline: %APPDATA% workspace", {
    root: workspaces,
    cwd: conv1,
    enter: enterConv1,
  });
  await row("PSDrive over the workspace", {
    root: workspaces,
    cwd: conv1,
    enter: `New-PSDrive -Name W -PSProvider FileSystem -Root ${q(conv1)} -Scope Global | Out-Null; Set-Location W:\\`,
  });
  await row("pwsh 7 by absolute path", {
    binShell: pwsh,
    root: workspaces,
    cwd: conv1,
    enter: enterConv1,
  });

  for (const dir of ancestors)
    spawnSync("icacls", [dir, "/grant", `${group}:(RD,RA,X,S)`]);
  await row("list+traverse ACE on each folder above (not inherited)", {
    root: workspaces,
    cwd: conv1,
    enter: enterConv1,
  });
  await row("same, pwsh 7", {
    binShell: pwsh,
    root: workspaces,
    cwd: conv1,
    enter: enterConv1,
  });
  for (const dir of ancestors) spawnSync("icacls", [dir, "/remove:g", group]);

  mkdirSync(junctionParent, { recursive: true });
  spawnSync("cmd", ["/d", "/c", "mklink", "/J", junction, conv1]);
  await row("junction from ProgramData to the workspace", {
    root: workspaces,
    cwd: junction,
    enter: `Set-Location -LiteralPath ${q(junction)}`,
  });

  await row("workspace under ProgramData", {
    root: dataRoot,
    cwd: dataConv,
    enter: `Set-Location -LiteralPath ${q(dataConv)}`,
  });

  log("\n### Output encoding\n");
  await SandboxManager.reset();
  await SandboxManager.initialize(policy([workspaces]));
  const text = "'測試 ✓ café'";
  log(
    `- Windows PowerShell, default console encoding: \`${await shellRun("powershell", text, conv1)}\``
  );
  log(
    `- Windows PowerShell, UTF-8 console encoding: \`${await shellRun("powershell", `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ${text}`, conv1)}\``
  );
  log(`- pwsh 7, default: \`${await shellRun(pwsh, text, conv1)}\``);
  log(
    `- Windows PowerShell \`>\` redirection writes: \`${await shellRun("powershell", `'x' > ${q(join(conv1, "redir.txt"))}; [BitConverter]::ToString([IO.File]::ReadAllBytes(${q(join(conv1, "redir.txt"))}))`, conv1)}\``
  );
  log(
    `- system code page: \`${spawnSync("cmd", ["/d", "/c", "chcp"], { encoding: "utf8" }).stdout.trim()}\``
  );

  spawnSync("cmd", ["/d", "/c", "rmdir", junction]);
  await SandboxManager.reset();
}

fixtures();
log(
  `## Windows sandbox probe\n\nNode ${process.version}, profile ${profile}, user ${process.env.USERNAME}\n`
);

log("### Install (no profile grant)\n");
const install = await step(
  "installWindowsSandboxAsync({ skipProfileGrant: true })",
  async () => {
    const result = await installWindowsSandboxAsync({
      skipProfileGrant: true,
      timeoutMs: 10 * 60_000,
      srtWin,
    });
    return {
      cancelled: result.cancelled ?? false,
      user: result.user.provisioned,
      wfp: result.wfp.state,
    };
  }
);

if (install) {
  const sandboxProfile = "C:\\Users\\srt-sandbox";
  log(
    `- srt-sandbox's profile exists before the first initialize: ${existsSync(sandboxProfile)}`
  );
  await step("initialize (first, one write root)", () =>
    SandboxManager.initialize(policy([workspaces])).then(() => "ok")
  );
  log(`- srt-sandbox's profile exists after it: ${existsSync(sandboxProfile)}`);
  if (process.env.PROBE_CHECKS) await checks();
  await step("reset", () => SandboxManager.reset().then(() => "ok"));
  await step("candidates", () => candidates().then(() => "done"));

  log("\n### Initializing again\n");
  await step("initialize (same policy)", () =>
    SandboxManager.initialize(policy([workspaces])).then(() => "ok")
  );
  await step("reset", () => SandboxManager.reset().then(() => "ok"));
  await step("initialize (a second write root added)", () =>
    SandboxManager.initialize(policy([workspaces, conv3])).then(() => "ok")
  );
  await step(
    "a command still runs after",
    async () => (await inside("'ran'", perExec())).out
  );
  await step("reset", () => SandboxManager.reset().then(() => "ok"));

  log("\n### Uninstall\n");
  await step("uninstallWindowsSandbox()", () =>
    uninstallWindowsSandbox({ timeoutMs: 20 * 60_000, srtWin })
  );
  await step("sandbox user after uninstall", async () => {
    const user = await getWindowsSandboxUserStatusAsync({ srtWin });
    return { provisioned: user.provisioned, group: user.groupExists };
  });
  await step(
    "WFP after uninstall",
    async () => (await checkWindowsSandboxStatusAsync({ srtWin })).wfp
  );
  await step("ACL on the write root after uninstall", () =>
    spawnSync("icacls", [workspaces], { encoding: "utf8" })
      .stdout.replace(/\s+/g, " ")
      .trim()
  );
}

for (const path of [
  userData,
  configDir,
  diary,
  sshKey,
  programData,
  join(profile, "solyx-ws"),
  "C:\\solyx-ws",
  join(process.env.APPDATA, "SolyxCwd"),
  join(process.env.ProgramData, "SolyxJ"),
  join(process.env.LOCALAPPDATA, "SolyxCwd"),
  join(profile, "SolyxCwd"),
])
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });

if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
