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
  forgetWindowsProfileReadAsync,
  getWindowsSandboxUserStatusAsync,
  grantWindowsProfileRead,
  installWindowsSandboxAsync,
  uninstallWindowsSandbox,
} from "@anthropic-ai/sandbox-runtime";

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
const diary = join(profile, "Documents", "solyx-probe-diary.txt");
const sshKey = join(profile, ".ssh", "solyx_probe_key");
const programData = join(
  process.env.ProgramData ?? "C:\\ProgramData",
  "SolyxProbe"
);
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
        out: out.replace(/\s+/g, " ").trim().slice(0, 220),
        ms: Date.now() - started,
      });
    });
  });
}

const psArgs = (command) => [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `$ErrorActionPreference='Stop'; ${command}`,
];

const outside = (command) =>
  run(PS, psArgs(command), { cwd: conv1, env: process.env });

async function inside(command, custom) {
  const { argv, env } = await SandboxManager.wrapWithSandboxArgv(
    `$ErrorActionPreference='Stop'; ${command}`,
    "powershell",
    custom,
    undefined,
    conv1
  );

  return run(argv[0], argv.slice(1), { cwd: conv1, env });
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
const perExec = (extra = {}) => ({
  filesystem: {
    denyRead: [conv2, ...(extra.denyRead ?? [])],
    allowWrite: [],
    denyWrite: [conv2],
  },
});

async function check(name, expect, command, options = {}) {
  const custom = options.custom ?? perExec();
  const base =
    expect === "allow" || expect === "info"
      ? undefined
      : await outside(command);
  let verdict;
  let got;

  try {
    got = await inside(command, custom);
  } catch (error) {
    got = {
      code: "wrap threw",
      out: String(error?.message ?? error).slice(0, 220),
      ms: 0,
    };
  }

  const leaked = options.leak ? options.leak(got.out) : got.code === 0;

  if (expect === "info") verdict = "INFO";
  else if (expect === "allow") verdict = got.code === 0 ? "PASS" : "FAIL";
  else if (!options.leak && base.code !== 0)
    verdict = "N/A (fails outside too)";
  else verdict = leaked ? "FAIL (leaked)" : "PASS";

  log(
    `| ${verdict} | ${name} | ${base ? `${base.code}: ${base.out}` : "-"} | ${got.code} (${got.ms} ms): ${got.out.replaceAll("|", "/")} |`
  );

  return got;
}

function fixtures() {
  for (const folder of [
    join(userData, "secrets"),
    conv1,
    conv2,
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

const sessionConfig = {
  network: { allowedDomains: [], deniedDomains: [] },
  filesystem: {
    denyRead: [userData, configDir],
    allowRead: [skill],
    allowWrite: [workspaces],
    denyWrite: [],
  },
};

async function checks(title) {
  log(`\n### ${title}\n`);
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
    `Add-Type -AssemblyName System.Security; [IO.File]::WriteAllText(${q(join(conv1, "blob.txt"))}, [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('dpapi-secret'), $null, 'CurrentUser')))`
  );

  const dummy = spawn(PS, ["-NoProfile", "-Command", "Start-Sleep 600"], {
    windowsHide: true,
  });
  const server = createServer((_req, res) => res.end("served"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  await check("whoami", "info", "whoami");
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
    "write in its workspace",
    "allow",
    `Set-Content -LiteralPath out.txt -Value ok; Get-Content out.txt`
  );
  await check(
    "write in the profile",
    "deny",
    `Set-Content -LiteralPath ${q(join(profile, "solyx-escape.txt"))} -Value x`
  );
  await check(
    "write in ProgramData",
    "deny",
    `Set-Content -LiteralPath ${q(join(process.env.ProgramData, "solyx-escape.txt"))} -Value x`
  );
  await check(
    "write in Users\\Public",
    "deny",
    `Set-Content -LiteralPath 'C:\\Users\\Public\\solyx-escape.txt' -Value x`
  );
  await check(
    "make a folder at C:\\",
    "deny",
    `New-Item -ItemType Directory -Path 'C:\\solyx-escape-dir' | Out-Null`
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
      custom: perExec({ denyRead: [programData] }),
    }
  );
  await check(
    "unseal the user's DPAPI blob",
    "deny",
    `Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String((Get-Content -Raw blob.txt).Trim()), $null, 'CurrentUser'))`
  );
  await check(
    "read the user's HKCU",
    "deny",
    `(Get-ItemProperty -LiteralPath 'Registry::HKEY_USERS\\${sid}\\Software\\SolyxProbe').secret`
  );
  await check(
    "stop a process of the user",
    "deny",
    `Stop-Process -Id ${dummy.pid} -Force; 'stopped'`
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  log(
    `|  | dummy process still alive after | | ${dummy.exitCode === null && dummy.signalCode === null} |`
  );
  await check(
    "see the app's environment",
    "deny",
    `"[$env:SOLYX_PROBE_SECRET]"`,
    { leak: (out) => out.includes("env-secret") }
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
    "info",
    `[Net.Dns]::GetHostAddresses('example.com') | Select-Object -First 1 | ForEach-Object { $_.ToString() }`
  );
  await check(
    "curl.exe https (Schannel)",
    "info",
    `curl.exe -sS -m 10 -o NUL -w '%{http_code}' https://example.com`
  );
  await check("node on PATH", "info", `node -v`);
  await check(
    "node fetch https",
    "deny",
    `node -e "fetch('https://example.com').then(r=>{console.log(r.status);process.exit(0)},e=>{console.error(e.cause?.code??e.message);process.exit(1)})"`
  );
  await check(
    "python on PATH",
    "info",
    `python -c "import sys; print(sys.version.split()[0])"`
  );
  await check(
    "proxy variables",
    "info",
    `Get-ChildItem env: | Where-Object Name -match 'proxy' | ForEach-Object { $_.Name }`
  );
  await check(
    "USERPROFILE / TEMP inside",
    "info",
    `"$env:USERPROFILE | $env:TEMP"`
  );

  await step("per-command allowWrite (expected to be refused on Windows)", () =>
    SandboxManager.wrapWithSandboxArgv(
      "exit 0",
      "powershell",
      { filesystem: { denyRead: [], allowWrite: [conv1], denyWrite: [] } },
      undefined,
      conv1
    ).then(() => "accepted")
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

  dummy.kill();
  server.close();
}

fixtures();
log(
  `## Windows sandbox probe\n\nNode ${process.version}, profile ${profile}, user ${process.env.USERNAME}\n`
);

log("### Before install\n");
await step("status", async () => {
  const status = await checkWindowsSandboxStatusAsync();
  return { user: status.user.provisioned, wfp: status.wfp };
});
await step("initialize without an install", async () => {
  await SandboxManager.initialize(sessionConfig);
  await SandboxManager.reset();
  return "initialized (unexpected)";
});
await SandboxManager.reset().catch(() => undefined);

log("\n### Install (no profile grant)\n");
const install = await step(
  "installWindowsSandboxAsync({ skipProfileGrant: true })",
  async () => {
    const result = await installWindowsSandboxAsync({
      skipProfileGrant: true,
      timeoutMs: 10 * 60_000,
    });
    return {
      cancelled: result.cancelled ?? false,
      user: result.user.provisioned,
      hidden: result.user.hiddenFromLogon,
      wfp: result.wfp,
      grant: result.profileGrant,
    };
  }
);

if (install) {
  await step("initialize with the session's policy", () =>
    SandboxManager.initialize(sessionConfig).then(() => "ok")
  );
  await checks("Without the profile grant");
  await step("reset", () => SandboxManager.reset().then(() => "ok"));

  log("\n### Profile grant, excluding the app's folders\n");
  const grant = await step(
    "grantWindowsProfileRead({ exclude: app folders })",
    () =>
      grantWindowsProfileRead({
        exclude: [userData, configDir],
        timeoutMs: 20 * 60_000,
      })
  );
  if (grant) {
    await step("initialize again", () =>
      SandboxManager.initialize(sessionConfig).then(() => "ok")
    );
    await checks("With the profile grant");
    await step("reset", () => SandboxManager.reset().then(() => "ok"));
    await step("forget the profile grant", () =>
      forgetWindowsProfileReadAsync({ timeoutMs: 20 * 60_000 }).then(() => "ok")
    );
  }

  log("\n### Uninstall\n");
  await step("uninstallWindowsSandbox()", () =>
    uninstallWindowsSandbox({ timeoutMs: 20 * 60_000 })
  );
  await step("sandbox user after uninstall", async () => {
    const user = await getWindowsSandboxUserStatusAsync();
    return { provisioned: user.provisioned, group: user.groupExists };
  });
  await step(
    "status after uninstall",
    async () => (await checkWindowsSandboxStatusAsync()).wfp
  );
  await step(
    "net user srt-sandbox",
    () => spawnSync("net", ["user", "srt-sandbox"], { encoding: "utf8" }).status
  );
}

for (const path of [
  userData,
  configDir,
  diary,
  sshKey,
  programData,
  join(profile, "solyx-escape.txt"),
  join(process.env.ProgramData, "solyx-escape.txt"),
  "C:\\Users\\Public\\solyx-escape.txt",
  "C:\\solyx-escape-dir",
])
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });

if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
