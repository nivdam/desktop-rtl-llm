#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, accessSync, constants } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(ROOT, "profiles");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const LOG_DIR = path.join(ROOT, "logs");
const STATE_DIR = path.join(ROOT, "state");
const STYLE_ID = "local-rtl-sidecar-style";
const RUNTIME_KEY = "__LOCAL_RTL_RUNTIME__";
const TARGET_STATE_FILE = path.join(STATE_DIR, "last-targets.json");
const CLAUDE_PROBE_STATE_FILE = path.join(STATE_DIR, "claude-probe-results.json");
const DOM_DUMP_FILE = (appName) => path.join(STATE_DIR, `${appName}-dom-dump.html`);
const DOM_DUMP_JSON_FILE = (appName) => path.join(STATE_DIR, `${appName}-dom-dump.json`);
const LOG_FILE = path.join(LOG_DIR, "runtime.log");

const VALID_APPS = new Set(["claude", "codex"]);
const VALID_TARGETS = new Set(["claude", "codex", "all"]);
const DEFAULT_TIMEOUT_MS = 20000;
const CLAUDE_PROBE_PORT = 9222;
const CLAUDE_PROBE_TIMEOUT_MS = 8000;

const options = parseArgs(process.argv.slice(2));
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(STATE_DIR, { recursive: true });

main().catch((error) => {
  logEvent("fatal", { error: String(error?.stack || error) });
  console.error(`Error: ${error.message || error}`);
  process.exit(1);
});

async function main() {
  if (options.listApps) {
    await listApps();
    return;
  }

  const apps = options.target === "all" ? ["claude", "codex"] : [options.target];
  const failures = [];

  for (const appName of apps) {
    const profile = loadProfile(appName);
    try {
      await runForApp(profile);
    } catch (error) {
      if (options.target !== "all") throw error;
      failures.push({ app: appName, error: error.message || String(error) });
      console.error(`${appName}: ${error.message || error}`);
      logEvent("app-failed-in-all", { app: appName, error: String(error?.stack || error) });
    }
  }

  if (failures.length > 0) {
    console.error("\nCompleted with failures:");
    for (const failure of failures) console.error(`- ${failure.app}: ${failure.error}`);
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const flags = new Set();
  let target = null;
  let port = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--port requires a numeric value");
      port = parsePort(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = parsePort(arg.slice("--port=".length));
      continue;
    }
    if (arg.startsWith("--")) {
      flags.add(arg);
      continue;
    }
    if (target) throw new Error(`Unexpected extra argument: ${arg}`);
    target = arg;
  }

  const knownFlags = new Set([
    "--list-apps",
    "--dry-run",
    "--debug-targets",
    "--diagnostics",
    "--dump-html",
    "--probe-launch",
    "--probe-only-no-launch",
    "--cleanup",
    "--install",
    "--reinstall",
    "--uninstall",
    "--status",
    "--help",
  ]);
  for (const flag of flags) {
    if (!knownFlags.has(flag)) {
      throw new Error(`Unknown flag: ${flag}`);
    }
  }

  if (flags.has("--help")) {
    printUsage();
    process.exit(0);
  }

  const installerFlags = ["--install", "--reinstall", "--uninstall", "--status"].filter((flag) => flags.has(flag));

  if (flags.has("--list-apps")) {
    if (installerFlags.length > 0) throw new Error("--list-apps cannot be combined with Claude install commands");
    return { listApps: true, installerCommand: null, dryRun: false, debugTargets: false, diagnostics: false, dumpHtml: false, probeLaunch: false, probeOnlyNoLaunch: false, cleanup: false, port, target: null };
  }

  if (!target || !VALID_TARGETS.has(target)) {
    printUsage();
    throw new Error("Expected app target: claude, codex, or all");
  }

  const probeLaunch = flags.has("--probe-launch");
  const probeOnlyNoLaunch = flags.has("--probe-only-no-launch");
  if (installerFlags.length > 1) throw new Error("Use only one Claude install command at a time");
  if (installerFlags.length > 0 && target !== "claude") throw new Error("Claude install commands are only supported for the claude target");
  if (installerFlags.length > 0 && (probeLaunch || probeOnlyNoLaunch || flags.has("--cleanup") || flags.has("--dry-run") || flags.has("--debug-targets") || flags.has("--diagnostics") || flags.has("--dump-html"))) {
    throw new Error("Claude install commands cannot be combined with probe, dry-run, debug, diagnostics, or cleanup flags");
  }
  if (probeLaunch && probeOnlyNoLaunch) throw new Error("Use either --probe-launch or --probe-only-no-launch, not both");
  if ((probeLaunch || probeOnlyNoLaunch) && target !== "claude") throw new Error("Probe commands are only supported for the claude target");
  if (flags.has("--cleanup") && !probeLaunch) throw new Error("--cleanup is only valid with --probe-launch");

  return {
    listApps: false,
    installerCommand: installerFlags[0] || null,
    dryRun: flags.has("--dry-run"),
    debugTargets: flags.has("--debug-targets"),
    diagnostics: flags.has("--diagnostics"),
    dumpHtml: flags.has("--dump-html"),
    probeLaunch,
    probeOnlyNoLaunch,
    cleanup: flags.has("--cleanup"),
    port: port ?? CLAUDE_PROBE_PORT,
    target,
  };
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function printUsage() {
  console.log(`Usage:
  run-rtl.sh claude --install
  run-rtl.sh claude --reinstall
  run-rtl.sh claude --status
  run-rtl.sh claude --uninstall
  run-rtl.sh claude --probe-launch [--cleanup]
  run-rtl.sh claude --probe-only-no-launch [--port 9222]
  run-rtl.sh codex [--dry-run] [--debug-targets] [--diagnostics] [--dump-html]
  run-rtl.sh all [--dry-run] [--debug-targets] [--diagnostics]
  run-rtl.sh --list-apps

Kill switch:
  RTL_DISABLED=1 run-rtl.sh claude`);
}

async function listApps() {
  console.log("RTL Desktop Runtime preflight\n");
  console.log(`Node: ${process.version}`);
  console.log(`WebSocket: ${typeof WebSocket}`);
  console.log(`fetch: ${typeof fetch}`);

  for (const appName of VALID_APPS) {
    const profile = loadProfile(appName);
    const appVersion = readAppVersion(profile.appPath);
    const executable = isExecutable(profile.appPath);
    const port = await reservePort();

    console.log(`\n${profile.name}`);
    console.log(`  appPath: ${profile.appPath}`);
    console.log(`  exists: ${existsSync(profile.appPath)}`);
    console.log(`  executable: ${executable}`);
    console.log(`  appVersion: ${appVersion || "unknown"}`);
    console.log(`  profileVersion: ${profile.profileVersion ?? "unknown"}`);
    console.log(`  testedAppVersions: ${(profile.testedAppVersions || []).join(", ") || "none"}`);
    console.log(`  localOverride: ${profile.__localOverridePath ? "yes" : "no"}`);
    console.log(`  minimumScore: ${profile.minimumScore}`);
    console.log(`  testPortAvailable: ${port}`);
  }
}

async function runForApp(profile) {
  if (options.installerCommand) {
    runClaudeInstaller(options.installerCommand);
    return;
  }

  validateProfile(profile);

  if (options.probeLaunch || options.probeOnlyNoLaunch) {
    const result = options.probeOnlyNoLaunch
      ? await runClaudeProbeOnlyNoLaunch(profile, options.port)
      : await runClaudeProbeLaunch(profile);
    if (result.overallStatus !== "cdp-ready") process.exitCode = 1;
    return;
  }

  if (process.env.RTL_DISABLED === "1") {
    launchPlain(profile);
    return;
  }

  if (profile.name === "claude") {
    console.error(`Claude Desktop on this machine does not support the clean CDP launch path.

Use the installer path instead:
  run-rtl.sh claude --install

Diagnostics are still available:
  run-rtl.sh claude --probe-launch
  run-rtl.sh claude --probe-only-no-launch --port 9222`);
    process.exitCode = 1;
    return;
  }

  let launchedByUs = false;
  let port = getRunningDebugPort(profile);
  if (port) {
    logEvent("attached", { app: profile.name, port });
  } else {
    if (isProcessRunning(profile)) {
      throw new Error(`${profile.name} is already running without a detectable debug port. Quit it first, then rerun this launcher so the local debug port can be enabled.`);
    }
    port = await reservePort();
    launchWithDebugPort(profile, port);
    launchedByUs = true;
  }
  try {
    await waitForEndpoint(port, DEFAULT_TIMEOUT_MS);
  } catch (error) {
    if (launchedByUs) quitApp(profile);
    throw error;
  }

  const targets = await collectTargets(port, profile);
  writeFileSync(TARGET_STATE_FILE, `${JSON.stringify({ time: new Date().toISOString(), app: profile.name, targets }, null, 2)}\n`);

  if (options.debugTargets || options.dryRun || options.diagnostics) {
    printTargetReport(profile, targets);
  }

  const selected = targets.find((target) => target.selected);
  if (!selected) {
    throw new Error(`No ${profile.name} target passed minimum score ${profile.minimumScore}. Use --debug-targets to inspect candidates.`);
  }

  if (options.dryRun) {
    console.log(`Dry run: selected ${selected.title || "(untitled)"} [score ${selected.score}]`);
    return;
  }

  const css = readFileSync(path.join(RUNTIME_DIR, "rtl.css"), "utf8");
  const runtime = readFileSync(path.join(RUNTIME_DIR, "rtl-runtime.js"), "utf8");
  const client = await CdpClient.connect(selected.webSocketDebuggerUrl);

  try {
    await injectCss(client, css);
    await injectRuntime(client, runtime, { ...profile, diagnostics: options.diagnostics || profile.verboseDiagnostics });
    const verified = await waitForVerifiedInjection(client);

    if (!verified.ok) {
      await rollbackInjection(client);
      throw new Error(`Verify failed: ${verified.reason}`);
    }

    if (options.dumpHtml) {
      const dump = await dumpHtml(client, profile);
      writeDomDump(profile, selected, verified, dump);
      console.log(`${profile.name}: DOM dump written to ${DOM_DUMP_FILE(profile.name)}`);
      console.log(`${profile.name}: JSON dump written to ${DOM_DUMP_JSON_FILE(profile.name)}`);
    }

    logEvent("injected", { app: profile.name, target: summarizeTarget(selected), verify: verified });
    console.log(`${profile.name}: RTL injected into "${selected.title || selected.url}"`);
    if (options.diagnostics) {
      console.log(JSON.stringify(verified, null, 2));
    }
  } finally {
    client.close();
  }
}

function runClaudeInstaller(command) {
  const script = path.join(ROOT, "claude-installer.mjs");
  const result = spawnSync(process.execPath, [script, command], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

async function runClaudeProbeOnlyNoLaunch(profile, port) {
  const endpoint = await checkCdpEndpoint(port, 1500);
  const state = {
    timestamp: new Date().toISOString(),
    app: "Claude",
    appVersion: readAppVersion(profile.appPath) || "unknown",
    appPath: profile.appPath,
    mode: "probe-only-no-launch",
    port,
    cleanup: false,
    existingProcesses: getClaudeProcessSnapshots(),
    attempts: [
      {
        name: "probe-only-no-launch",
        args: [],
        port,
        processCreated: false,
        pid: null,
        flagsPresent: false,
        endpointReachable: endpoint.reachable,
        diagnosis: endpoint.reachable ? "cdp-ready" : "unsupported-clean-mode",
        endpoint,
      },
    ],
  };
  state.overallStatus = endpoint.reachable ? "cdp-ready" : "unsupported-clean-mode";
  writeClaudeProbeState(state);
  printClaudeProbeSummary(state);
  return state;
}

async function runClaudeProbeLaunch(profile) {
  const before = getClaudeProcessSnapshots();
  if (before.length > 0) {
    const state = {
      timestamp: new Date().toISOString(),
      app: "Claude",
      appVersion: readAppVersion(profile.appPath) || "unknown",
      appPath: profile.appPath,
      mode: "probe-launch",
      cleanup: options.cleanup,
      existingProcesses: before,
      attempts: [
        {
          name: "preflight",
          args: [],
          port: CLAUDE_PROBE_PORT,
          processCreated: false,
          pid: null,
          flagsPresent: false,
          endpointReachable: false,
          diagnosis: "single-instance-suspected",
          note: "Claude/Claude Helper processes existed before probe launch.",
        },
      ],
      overallStatus: "single-instance-suspected",
    };
    writeClaudeProbeState(state);
    printClaudeProbeSummary(state);
    return state;
  }

  const attempts = [];
  const definitions = [
    {
      name: "direct-binary + --remote-debugging-port=9222",
      args: [`--remote-debugging-port=${CLAUDE_PROBE_PORT}`],
      port: CLAUDE_PROBE_PORT,
    },
    {
      name: "direct-binary + --remote-debugging-port=9222 + --remote-debugging-address=127.0.0.1",
      args: [`--remote-debugging-port=${CLAUDE_PROBE_PORT}`, "--remote-debugging-address=127.0.0.1"],
      port: CLAUDE_PROBE_PORT,
    },
  ];

  let stoppedEarly = false;
  for (const definition of definitions) {
    const attempt = await runClaudeProbeAttempt(profile, definition);
    attempts.push(attempt);

    if (attempt.diagnosis === "cdp-ready") break;
    if (attempt.processCreated && attempt.processAlive && !options.cleanup) {
      attempt.note = "Probe-launched process left running because --cleanup was not set. Remaining attempts were not launched.";
      stoppedEarly = true;
      break;
    }
    if (options.cleanup && attempt.pid) {
      attempt.cleanupResult = cleanupProbePid(profile, attempt.pid);
      await sleep(500);
    }
  }

  const overallStatus = computeClaudeProbeOverallStatus(attempts, stoppedEarly);
  const state = {
    timestamp: new Date().toISOString(),
    app: "Claude",
    appVersion: readAppVersion(profile.appPath) || "unknown",
    appPath: profile.appPath,
    mode: "probe-launch",
    cleanup: options.cleanup,
    existingProcesses: before,
    attempts,
    overallStatus,
  };
  writeClaudeProbeState(state);
  printClaudeProbeSummary(state);
  return state;
}

async function runClaudeProbeAttempt(profile, definition) {
  const child = await spawnDirectProbe(profile.appPath, definition.args);
  await sleep(1200);

  const pidSnapshot = child.pid ? getPidSnapshot(child.pid) : null;
  const afterProcesses = getClaudeProcessSnapshots();
  const endpoint = await checkCdpEndpoint(definition.port, CLAUDE_PROBE_TIMEOUT_MS);
  const command = pidSnapshot?.command || "";
  const processCreated = Boolean(child.pid);
  const processAlive = Boolean(pidSnapshot);
  const flagsPresent = definition.args.some((arg) => arg.startsWith("--remote-debugging-port=") && command.includes(arg));
  const diagnosis = classifyClaudeProbeAttempt({ child, processCreated, processAlive, flagsPresent, endpoint, afterProcesses });

  return {
    name: definition.name,
    args: definition.args,
    port: definition.port,
    processCreated,
    processAlive,
    pid: child.pid || null,
    ps: pidSnapshot,
    launchError: child.error || "",
    flagsPresent,
    endpointReachable: endpoint.reachable,
    endpoint,
    helperProcesses: afterProcesses,
    diagnosis,
  };
}

function classifyClaudeProbeAttempt({ child, processCreated, processAlive, flagsPresent, endpoint, afterProcesses }) {
  if (processAlive && flagsPresent && endpoint.reachable) return "cdp-ready";
  if (processAlive && flagsPresent && !endpoint.reachable) return "flags-present-no-endpoint";
  if (processAlive && !flagsPresent && !endpoint.reachable) return "flags-dropped";
  if (!processAlive && afterProcesses.length > 0) return "single-instance-suspected";
  if (!processCreated || !processAlive || child.error) return "launch-failed";
  return "unsupported-clean-mode";
}

function computeClaudeProbeOverallStatus(attempts, stoppedEarly) {
  if (attempts.some((attempt) => attempt.diagnosis === "cdp-ready")) return "cdp-ready";
  if (attempts.some((attempt) => attempt.diagnosis === "single-instance-suspected")) return "single-instance-suspected";
  if (stoppedEarly) return attempts.at(-1)?.diagnosis || "unsupported-clean-mode";
  return "unsupported-clean-mode";
}

async function spawnDirectProbe(appPath, args) {
  return await new Promise((resolve) => {
    const child = spawn(appPath, args, { detached: true, stdio: "ignore" });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => finish({ pid: null, error: error.message || String(error) }));
    setTimeout(() => {
      child.unref();
      finish({ pid: child.pid || null, error: "" });
    }, 100);
  });
}

async function checkCdpEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        return {
          reachable: true,
          status: response.status,
          targetCount: Array.isArray(targets) ? targets.length : 0,
          targets: Array.isArray(targets) ? targets.map((target) => ({ type: target.type, title: target.title || "", url: target.url || "" })) : [],
        };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message || String(error);
    }
    await sleep(250);
  }
  return { reachable: false, status: 0, targetCount: 0, targets: [], lastError };
}

function getClaudeProcessSnapshots() {
  const byPid = new Map();
  for (const pattern of ["Claude", "Claude Helper"]) {
    const result = spawnSync("pgrep", ["-fl", pattern], { encoding: "utf8" });
    if (result.status !== 0) continue;
    for (const line of result.stdout.split("\n")) {
      const snapshot = parseProcessLine(line);
      if (!snapshot) continue;
      if (!isClaudeProcessCommand(snapshot.command)) continue;
      byPid.set(snapshot.pid, snapshot);
    }
  }
  return Array.from(byPid.values()).sort((a, b) => a.pid - b.pid);
}

function getPidSnapshot(pid) {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,command="], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return parseProcessLine(result.stdout.trim());
}

function parseProcessLine(line) {
  const match = String(line || "").trim().match(/^(\d+)\s+(?:(\d+)\s+)?(.+)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    ppid: match[2] ? Number(match[2]) : null,
    command: match[3],
  };
}

function isClaudeProcessCommand(command) {
  return /\/Claude\.app\/Contents\//.test(command) && /Claude(?: Helper)?/.test(command);
}

function cleanupProbePid(profile, pid) {
  const snapshot = getPidSnapshot(pid);
  if (!snapshot || !snapshot.command.includes(profile.appPath)) {
    return { attempted: false, terminated: false, reason: "pid-not-owned-by-this-probe" };
  }
  const result = spawnSync("kill", ["-TERM", String(pid)], { encoding: "utf8" });
  return {
    attempted: true,
    terminated: result.status === 0,
    reason: result.status === 0 ? "" : (result.stderr || result.stdout || "kill-failed").trim(),
  };
}

function writeClaudeProbeState(state) {
  writeFileSync(CLAUDE_PROBE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  logEvent("claude-probe", {
    appVersion: state.appVersion,
    mode: state.mode,
    cleanup: state.cleanup,
    overallStatus: state.overallStatus,
    attempts: state.attempts.map((attempt) => ({
      name: attempt.name,
      pid: attempt.pid,
      diagnosis: attempt.diagnosis,
      flagsPresent: attempt.flagsPresent,
      endpointReachable: attempt.endpointReachable,
    })),
  });
}

function printClaudeProbeSummary(state) {
  const ready = state.overallStatus === "cdp-ready";
  console.log(`Claude Probe Result: ${ready ? "READY" : "FAILED"}`);
  console.log("");
  console.log(`App version: ${state.appVersion}`);
  console.log(`Mode: ${state.mode}`);
  console.log(`Cleanup: ${state.cleanup ? "yes" : "no"}`);
  console.log("");

  for (const attempt of state.attempts) {
    console.log(`Attempt: ${attempt.name}`);
    console.log(`Process created: ${attempt.processCreated ? "yes" : "no"}`);
    console.log(`Process alive after launch: ${attempt.processAlive ? "yes" : "no"}`);
    console.log(`PID: ${attempt.pid ?? "none"}`);
    console.log(`Flags present in process args: ${attempt.flagsPresent ? "yes" : "no"}`);
    console.log(`Endpoint reachable: ${attempt.endpointReachable ? "yes" : "no"}`);
    console.log(`Diagnosis: ${attempt.diagnosis}`);
    if (attempt.note) console.log(`Note: ${attempt.note}`);
    if (attempt.endpoint?.lastError) console.log(`Endpoint error: ${attempt.endpoint.lastError}`);
    console.log("");
  }

  console.log("Next step:");
  for (const line of nextClaudeProbeSteps(state)) console.log(`- ${line}`);
  console.log("");
  console.log(`State written to: ${CLAUDE_PROBE_STATE_FILE}`);
}

function nextClaudeProbeSteps(state) {
  if (state.overallStatus === "cdp-ready") {
    if (state.cleanup) {
      return ["rerun the probe without --cleanup, then run claude --diagnostics while Claude is still open"];
    }
    return ["run: run-rtl.sh claude --diagnostics"];
  }
  if (state.overallStatus === "single-instance-suspected") {
    return ["quit Claude and Claude Helper processes manually", "retry direct binary probe", "do not patch app.asar yet"];
  }
  return [
    "quit Claude manually if you do not need the probe-launched instance",
    "ensure no Claude/Claude Helper processes exist before retrying",
    ...(state.cleanup ? [] : ["retry with --cleanup if you want both clean launch variants tested in one run"]),
    "do not patch app.asar yet",
  ];
}

function loadProfile(appName) {
  const basePath = path.join(PROFILE_DIR, `${appName}.json`);
  const localPath = path.join(PROFILE_DIR, `${appName}.local.json`);
  const base = readJson(basePath);
  const local = existsSync(localPath) ? readJson(localPath) : {};
  const merged = deepMerge(base, local);
  if (existsSync(localPath) && Object.keys(local).length > 0) {
    merged.__localOverridePath = localPath;
  }
  return merged;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return output;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validateProfile(profile) {
  if (!profile.name || !VALID_APPS.has(profile.name)) throw new Error("Profile must include a valid name");
  if (!profile.appPath || !existsSync(profile.appPath)) throw new Error(`${profile.name} appPath not found: ${profile.appPath}`);
  if (!isExecutable(profile.appPath)) throw new Error(`${profile.name} binary is not executable: ${profile.appPath}`);
  if (!Number.isFinite(profile.minimumScore)) throw new Error(`${profile.name} profile must include numeric minimumScore`);
}

function isExecutable(filePath) {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isProcessRunning(profile) {
  const processName = path.basename(profile.appPath);
  const result = spawnSync("pgrep", ["-x", processName], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function getRunningDebugPort(profile) {
  const processName = path.basename(profile.appPath);
  const result = spawnSync("pgrep", ["-fl", processName], { encoding: "utf8" });
  if (result.status !== 0) return 0;

  for (const line of result.stdout.split("\n")) {
    if (!line.includes(profile.appPath)) continue;
    const match = line.match(/--remote-debugging-port=(\d+)/);
    if (match) return Number(match[1]);
  }

  return 0;
}

function launchPlain(profile) {
  if (isProcessRunning(profile)) {
    console.log(`${profile.name}: already running; RTL_DISABLED=1 so no injection will be attempted.`);
    return;
  }
  spawnApp(profile, []);
  console.log(`${profile.name}: launched without RTL injection because RTL_DISABLED=1.`);
}

function launchWithDebugPort(profile, port) {
  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ];
  spawnApp(profile, args);
  logEvent("launched", { app: profile.name, port, appPath: profile.appPath });
}

function quitApp(profile) {
  const appName = profile.appName || capitalize(profile.name);
  spawn("osascript", ["-e", `tell application ${JSON.stringify(appName)} to quit`], { detached: true, stdio: "ignore" }).unref();
  logEvent("quit-after-failed-debug", { app: profile.name, appName });
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}

function spawnApp(profile, args) {
  const bundlePath = getBundlePath(profile.appPath);
  if (bundlePath) {
    spawn("open", ["-na", bundlePath, "--args", ...args], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn(profile.appPath, args, { detached: true, stdio: "ignore" }).unref();
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Keep polling.
    }
    await sleep(250);
  }
  throw new Error(`DevTools endpoint did not start on 127.0.0.1:${port}`);
}

async function collectTargets(port, profile) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let latestTargets = [];

  while (Date.now() < deadline) {
    latestTargets = await collectTargetsOnce(port, profile);
    const selected = latestTargets.find((target) => target.selected);
    if (selected && isTargetReadyForInjection(selected)) return latestTargets;
    await sleep(500);
  }

  return latestTargets;
}

async function collectTargetsOnce(port, profile) {
  const rawTargets = await waitForTargets(port, DEFAULT_TIMEOUT_MS);
  const targets = [];

  for (const raw of rawTargets) {
    const candidate = {
      id: raw.id,
      type: raw.type,
      url: raw.url || "",
      title: raw.title || "",
      webSocketDebuggerUrl: raw.webSocketDebuggerUrl,
      initialScore: scoreTargetMetadata(raw, profile),
      probe: null,
      score: 0,
      selected: false,
      skippedReason: "",
    };

    if (raw.type !== "page" || !raw.webSocketDebuggerUrl || isNonInjectableUrl(candidate.url)) {
      candidate.score = candidate.initialScore;
      candidate.skippedReason = "non-page-or-non-injectable";
      targets.push(candidate);
      continue;
    }

    const client = await CdpClient.connect(raw.webSocketDebuggerUrl);
    try {
      candidate.probe = await probeTarget(client, profile);
      candidate.score = candidate.initialScore + scoreProbe(candidate.probe);
      if (candidate.probe.authCount > 0) candidate.score -= 45;
    } catch (error) {
      candidate.score = candidate.initialScore;
      candidate.skippedReason = `probe-failed: ${error.message}`;
    } finally {
      client.close();
    }

    targets.push(candidate);
  }

  const eligible = targets
    .filter((target) => target.webSocketDebuggerUrl && target.type === "page" && target.score >= profile.minimumScore)
    .sort((a, b) => b.score - a.score);

  if (eligible[0]) {
    eligible[0].selected = true;
    for (const target of targets) {
      if (target.id === eligible[0].id) target.selected = true;
      else if (!target.skippedReason) target.skippedReason = target.score >= profile.minimumScore ? "lower-score" : "below-threshold";
    }
  } else {
    for (const target of targets) {
      if (!target.skippedReason) target.skippedReason = "below-threshold";
    }
  }

  return targets.map(redactTargetForState);
}

async function waitForTargets(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      lastStatus = String(response.status);
      if (response.ok) {
        const targets = await response.json();
        if (Array.isArray(targets) && targets.length > 0) return targets;
      }
    } catch (error) {
      lastStatus = error.message;
    }
    await sleep(300);
  }

  throw new Error(`No DevTools targets appeared on port ${port}; last status: ${lastStatus}`);
}

function scoreTargetMetadata(target, profile) {
  let score = 0;
  if (target.type === "page") score += 15;
  if (matchesHint(target.url || "", profile.urlHints)) score += 30;
  if (matchesHint(target.title || "", profile.titleHints)) score += 25;
  if ((target.url || "").startsWith("http")) score += 5;
  return score;
}

function scoreProbe(probe) {
  if (!probe) return 0;
  let score = 0;
  score += Math.min(30, probe.allowCount * 3);
  score += Math.min(10, probe.inputCount * 2);
  score -= Math.min(20, Math.floor(probe.denyCount / 6));
  return score;
}

function isTargetReadyForInjection(target) {
  const probe = target?.probe;
  if (!target?.selected || !probe) return false;
  return Number(probe.allowCount || 0) > 0 || Number(probe.inputCount || 0) > 0;
}

function matchesHint(value, hints = []) {
  const lower = value.toLowerCase();
  return hints.some((hint) => lower.includes(String(hint).toLowerCase()));
}

function isNonInjectableUrl(url) {
  return !url || url === "about:blank" || url.startsWith("devtools://") || url.startsWith("chrome://");
}

async function probeTarget(client, profile) {
  const expression = `(${probeTargetInPage.toString()})(${JSON.stringify(profile)})`;
  return await client.evaluate(expression);
}

function probeTargetInPage(profile) {
  const countMatches = (selectors) => {
    const result = {};
    let total = 0;
    for (const selector of selectors || []) {
      try {
        const count = document.querySelectorAll(selector).length;
        result[selector] = count;
        total += count;
      } catch {
        result[selector] = -1;
      }
    }
    return { result, total };
  };

  const allow = countMatches(profile.allowSelectors);
  const deny = countMatches([...(profile.denySelectors || []), ...(profile.authDenySelectors || [])]);
  const input = countMatches(profile.inputSelectors);
  const auth = countMatches(profile.authDenySelectors);

  return {
    href: location.href,
    title: document.title,
    rootSignatures: [
      document.documentElement?.tagName,
      document.body?.id ? `body#${document.body.id}` : "body",
      document.body?.className ? `body.${String(document.body.className).split(/\s+/).slice(0, 4).join(".")}` : "",
    ].filter(Boolean),
    allowMatches: allow.result,
    denyMatches: deny.result,
    inputMatches: input.result,
    authMatches: auth.result,
    allowCount: allow.total,
    denyCount: deny.total,
    inputCount: input.total,
    authCount: auth.total,
  };
}

async function injectCss(client, css) {
  const expression = `(() => {
    const id = ${JSON.stringify(STYLE_ID)};
    document.getElementById(id)?.remove();
    const style = document.createElement("style");
    style.id = id;
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
    return true;
  })()`;
  await client.evaluate(expression);
}

async function injectRuntime(client, runtime, profile) {
  await client.evaluate(`window.__LOCAL_RTL_PROFILE__ = ${JSON.stringify(profile)};`);
  await client.evaluate(runtime);
}

async function verifyInjection(client) {
  const result = await client.evaluate(`(() => {
    const runtime = window.${RUNTIME_KEY};
    const stats = runtime?.getStats?.() || null;
    const styleExists = !!document.getElementById(${JSON.stringify(STYLE_ID)});
    const runtimeExists = !!runtime;
    const scanned = Number(stats?.scanned || 0);
    return {
      styleExists,
      runtimeExists,
      stats,
      ok: styleExists && runtimeExists && scanned > 0,
      reason: !styleExists ? "style-missing" : !runtimeExists ? "runtime-missing" : scanned <= 0 ? "no-allow-containers-scanned" : ""
    };
  })()`);
  return result;
}

async function waitForVerifiedInjection(client, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 20000);
  const intervalMs = Number(options.intervalMs || 500);
  const deadline = Date.now() + timeoutMs;
  let latest = await verifyInjection(client);

  while (!latest.ok && latest.reason === "no-allow-containers-scanned" && Date.now() < deadline) {
    await sleep(intervalMs);
    latest = await verifyInjection(client);
  }

  return latest;
}

async function dumpHtml(client, profile) {
  const expression = `(${dumpHtmlInPage.toString()})(${JSON.stringify(profile)})`;
  return await client.evaluate(expression);
}

function dumpHtmlInPage(profile) {
  const selectors = [
    "[data-content-search-unit-key]",
    "[data-message-author-role]",
    "[data-epitaxy-entry]",
    ".group\\/msg",
    ".text-size-chat",
    ".epitaxy-markdown",
    ".whitespace-pre-wrap",
    ".prose",
    "[class*='message']",
    ...(profile.messageSelectors || []),
  ];
  const seen = new Set();
  const entries = [];

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  for (const selector of selectors) {
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(selector));
    } catch {
      continue;
    }

    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (seen.has(node)) continue;
      if (!isVisible(node)) continue;
      const text = cleanText(node.innerText || node.textContent);
      if (!text || text.length < 2) continue;
      if (!/[\u0590-\u05ffA-Za-z]/.test(text)) continue;
      seen.add(node);
      const computed = getComputedStyle(node);
      entries.push({
        selector,
        tag: node.tagName.toLowerCase(),
        id: node.id || "",
        className: node.className || "",
        dir: node.getAttribute("dir") || "",
        dataLlm: document.documentElement.getAttribute("data-llm") || "",
        computedDirection: computed.direction,
        computedUnicodeBidi: computed.unicodeBidi,
        computedTextAlign: computed.textAlign,
        text: text.slice(0, 500),
        outerHTML: node.outerHTML,
      });
      if (entries.length >= 40) break;
    }
    if (entries.length >= 40) break;
  }

  return {
    href: location.href,
    title: document.title,
    documentElement: {
      className: document.documentElement.className,
      dataLlm: document.documentElement.getAttribute("data-llm") || "",
      dir: document.documentElement.getAttribute("dir") || "",
    },
    entries,
  };
}

function writeDomDump(profile, target, verify, dump) {
  const json = {
    time: new Date().toISOString(),
    app: profile.name,
    target: summarizeTarget(target),
    verify,
    dump,
  };
  writeFileSync(DOM_DUMP_JSON_FILE(profile.name), `${JSON.stringify(json, null, 2)}\n`);

  const sections = dump.entries.map((entry, index) => {
    return `<section>
  <h2>#${index + 1} ${escapeHtml(entry.tag)} ${escapeHtml(entry.selector)}</h2>
  <dl>
    <dt>text</dt><dd><pre>${escapeHtml(entry.text)}</pre></dd>
    <dt>dir</dt><dd>${escapeHtml(entry.dir)}</dd>
    <dt>computed</dt><dd>${escapeHtml(`${entry.computedDirection} / ${entry.computedUnicodeBidi} / ${entry.computedTextAlign}`)}</dd>
    <dt>class</dt><dd><code>${escapeHtml(String(entry.className))}</code></dd>
  </dl>
  <details open><summary>outerHTML</summary><pre><code>${escapeHtml(entry.outerHTML)}</code></pre></details>
</section>`;
  }).join("\n");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(profile.name)} DOM dump</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; line-height: 1.45; }
    section { border-top: 1px solid #ccc; padding: 16px 0; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f6f6f6; padding: 12px; border-radius: 6px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    dt { font-weight: 700; margin-top: 8px; }
    dd { margin-inline-start: 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(profile.name)} DOM dump</h1>
  <p><strong>URL:</strong> ${escapeHtml(dump.href)}</p>
  <p><strong>Title:</strong> ${escapeHtml(dump.title)}</p>
  <p><strong>data-llm:</strong> ${escapeHtml(dump.documentElement.dataLlm)}</p>
  ${sections}
</body>
</html>
`;
  writeFileSync(DOM_DUMP_FILE(profile.name), html);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function rollbackInjection(client) {
  await client.evaluate(`(() => {
    try { window.${RUNTIME_KEY}?.cleanup?.(); } catch (error) {}
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    try { delete window.${RUNTIME_KEY}; } catch (error) { window.${RUNTIME_KEY} = undefined; }
    try { delete window.__LOCAL_RTL_PROFILE__; } catch (error) { window.__LOCAL_RTL_PROFILE__ = undefined; }
    return true;
  })()`);
}

function printTargetReport(profile, targets) {
  console.log(`\n${profile.name}: target report`);
  for (const target of targets) {
    const marker = target.selected ? "*" : " ";
    console.log(`${marker} score=${target.score} type=${target.type} title=${JSON.stringify(target.title)} url=${target.url}`);
    console.log(`  reason=${target.selected ? "selected" : target.skippedReason || "candidate"} allow=${target.probe?.allowCount ?? 0} deny=${target.probe?.denyCount ?? 0} auth=${target.probe?.authCount ?? 0} input=${target.probe?.inputCount ?? 0}`);
  }
}

function redactTargetForState(target) {
  return {
    id: target.id,
    type: target.type,
    url: target.url,
    title: target.title,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    initialScore: target.initialScore,
    probe: target.probe,
    score: target.score,
    selected: target.selected,
    skippedReason: target.skippedReason,
  };
}

function summarizeTarget(target) {
  return { url: target.url, title: target.title, score: target.score, id: target.id };
}

function readAppVersion(appPath) {
  const bundlePath = getBundlePath(appPath);
  if (!bundlePath) return "";
  const plist = path.join(bundlePath, "Contents", "Info.plist");
  if (!existsSync(plist)) return "";
  const result = spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function getBundlePath(appPath) {
  const bundlePath = appPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  return bundlePath.endsWith(".app") ? bundlePath : "";
}

function logEvent(event, details) {
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...details });
  appendFileSync(LOG_FILE, `${line}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  static async connect(url) {
    const client = new CdpClient(url);
    await client.open();
    return client;
  }

  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  async open() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("message", (event) => this.handleMessage(event));
    this.ws.addEventListener("close", () => this.rejectAll(new Error("CDP socket closed")));
    this.ws.addEventListener("error", () => this.rejectAll(new Error("CDP socket error")));
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  handleMessage(event) {
    const message = JSON.parse(event.data);
    if (!message.id || !this.pending.has(message.id)) return;
    const { resolve, reject } = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message.result);
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(payload);
    return await promise;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  rejectAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // Ignore close failures.
    }
  }
}
