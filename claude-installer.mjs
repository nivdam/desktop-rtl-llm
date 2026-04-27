#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(ROOT, "state");
const LOG_DIR = path.join(ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, "runtime.log");
const INSTALL_STATE_FILE = path.join(STATE_DIR, "claude-install.json");
const ADHOC_ENTITLEMENTS_FILE = path.join(STATE_DIR, "claude-adhoc-entitlements.plist");

const SOURCE_APP = "/Applications/Claude.app";
const COPY_APP = path.join(os.homedir(), "Applications", "Claude RTL.app");
const SOURCE_ASAR = path.join(SOURCE_APP, "Contents", "Resources", "app.asar");
const COPY_ASAR = path.join(COPY_APP, "Contents", "Resources", "app.asar");
const COPY_PLIST = path.join(COPY_APP, "Contents", "Info.plist");
const PRELOAD_PATCH_PATHS = [
  ".vite/build/mainView.js",
  ".vite/build/mainWindow.js",
];
const MARKER = "// LOCAL-RTL-DESKTOP-CLAUDE-BOOTSTRAP";

mkdirSync(STATE_DIR, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const command = process.argv[2] || "--help";

main().catch((error) => {
  logEvent("claude-installer-fatal", { error: String(error?.stack || error) });
  console.error(`Error: ${error.message || error}`);
  process.exit(1);
});

async function main() {
  if (command === "--install") return install();
  if (command === "--reinstall") {
    uninstall({ quiet: true });
    return install();
  }
  if (command === "--uninstall") return uninstall({ quiet: false });
  if (command === "--status") return status();
  printUsage();
  if (command !== "--help") throw new Error(`Unknown Claude installer command: ${command}`);
}

function printUsage() {
  console.log(`Usage:
  run-rtl.sh claude --install
  run-rtl.sh claude --reinstall
  run-rtl.sh claude --uninstall
  run-rtl.sh claude --status`);
}

function install() {
  assertSourceApp();
  assertClaudeNotRunning();

  const sourceVersion = readAppVersion(path.join(SOURCE_APP, "Contents", "MacOS", "Claude"));
  const sourceAsarSha256 = sha256File(SOURCE_ASAR);

  if (existsSync(COPY_APP)) {
    throw new Error(`${COPY_APP} already exists. Run --reinstall or --uninstall first.`);
  }

  try {
    mkdirSync(path.dirname(COPY_APP), { recursive: true });
    copyAppBundle();
    clearQuarantine(COPY_APP);
    patchInfoPlist();
    patchClaudeAsar();
    updateAsarIntegrity();
    signCopy();
    verifySignature();

    const state = {
      installedAt: new Date().toISOString(),
      sourceAppPath: SOURCE_APP,
      sourceVersion,
      sourceAsarSha256,
      copyAppPath: COPY_APP,
      copyVersion: readAppVersion(path.join(COPY_APP, "Contents", "MacOS", "Claude")),
      runtimePath: path.join(ROOT, "runtime", "rtl-runtime.js"),
      cssPath: path.join(ROOT, "runtime", "rtl.css"),
      profilePath: path.join(ROOT, "profiles", "claude.json"),
      patchedFiles: PRELOAD_PATCH_PATHS,
      signingIdentity: "ad-hoc",
      entitlements: "source entitlements plus com.apple.security.cs.disable-library-validation",
      fusesFlipped: [],
    };
    writeFileSync(INSTALL_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
    logEvent("claude-install", state);

    console.log(`Installed: ${COPY_APP}`);
    console.log("Open it from Spotlight/Finder as \"Claude RTL\".");
    console.log("If macOS blocks first launch, right-click the app and choose Open once.");
  } catch (error) {
    rmSync(COPY_APP, { recursive: true, force: true });
    throw error;
  }
}

function uninstall({ quiet }) {
  rmSync(COPY_APP, { recursive: true, force: true });
  rmSync(INSTALL_STATE_FILE, { force: true });
  logEvent("claude-uninstall", { copyAppPath: COPY_APP });
  if (!quiet) console.log(`Removed: ${COPY_APP}`);
}

function status() {
  const sourceExists = existsSync(SOURCE_APP);
  const copyExists = existsSync(COPY_APP);
  const state = existsSync(INSTALL_STATE_FILE) ? JSON.parse(readFileSync(INSTALL_STATE_FILE, "utf8")) : null;
  const currentSourceHash = existsSync(SOURCE_ASAR) ? sha256File(SOURCE_ASAR) : "";
  const sourceChanged = Boolean(state?.sourceAsarSha256 && currentSourceHash && state.sourceAsarSha256 !== currentSourceHash);

  console.log("Claude RTL status");
  console.log(`  sourceExists: ${sourceExists}`);
  console.log(`  copyExists: ${copyExists}`);
  console.log(`  sourceVersion: ${sourceExists ? readAppVersion(path.join(SOURCE_APP, "Contents", "MacOS", "Claude")) || "unknown" : "missing"}`);
  console.log(`  copyVersion: ${copyExists ? readAppVersion(path.join(COPY_APP, "Contents", "MacOS", "Claude")) || "unknown" : "missing"}`);
  console.log(`  installedAt: ${state?.installedAt || "not installed"}`);
  console.log(`  sourceChangedSinceInstall: ${sourceChanged ? "yes" : "no"}`);
  if (sourceChanged) console.log("  nextStep: run-rtl.sh claude --reinstall");
}

function assertSourceApp() {
  if (!existsSync(SOURCE_APP)) throw new Error(`${SOURCE_APP} not found`);
  if (!existsSync(SOURCE_ASAR)) throw new Error(`${SOURCE_ASAR} not found`);
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", SOURCE_APP], { encoding: "utf8" });
  if (verify.status !== 0) {
    throw new Error(`Source Claude.app signature verification failed: ${(verify.stderr || verify.stdout).trim()}`);
  }
}

function assertClaudeNotRunning() {
  const processes = getClaudeProcesses();
  if (processes.length > 0) {
    throw new Error(`Claude is running. Quit Claude/Claude Helper first.\n${processes.map((item) => `  ${item}`).join("\n")}`);
  }
}

function getClaudeProcesses() {
  const output = [];
  for (const pattern of ["Claude", "Claude Helper"]) {
    const result = spawnSync("pgrep", ["-fl", pattern], { encoding: "utf8" });
    if (result.status !== 0) continue;
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (/\/Claude(?: RTL)?\.app\/Contents\//.test(trimmed)) output.push(trimmed);
    }
  }
  return Array.from(new Set(output));
}

function copyAppBundle() {
  const ditto = spawnSync("ditto", [SOURCE_APP, COPY_APP], { encoding: "utf8" });
  if (ditto.status === 0) return;
  cpSync(SOURCE_APP, COPY_APP, { recursive: true, force: false, errorOnExist: true });
}

function clearQuarantine(appPath) {
  spawnSync("xattr", ["-dr", "com.apple.quarantine", appPath], { encoding: "utf8" });
}

function patchInfoPlist() {
  // Electron derives helper app names from CFBundleName. Keep it as "Claude";
  // the app bundle path and display name provide the visible "Claude RTL" label.
  plistSet(COPY_PLIST, "CFBundleName", "Claude");
  plistSet(COPY_PLIST, "CFBundleDisplayName", "Claude RTL");
  const bundleId = plistRead(COPY_PLIST, "CFBundleIdentifier");
  if (bundleId !== "com.anthropic.claudefordesktop") {
    throw new Error(`Unexpected bundle id in copy: ${bundleId}`);
  }
}

function patchClaudeAsar() {
  const archive = readAsar(COPY_ASAR);
  const bootstrap = buildBootstrap();

  for (const filePath of PRELOAD_PATCH_PATHS) {
    const current = archive.files.get(filePath);
    if (!current) throw new Error(`${filePath} not found in app.asar`);
    const original = current.toString("utf8");
    if (original.includes(MARKER)) throw new Error(`Claude RTL bootstrap already exists in ${filePath}`);
    archive.files.set(filePath, Buffer.from(`${original}\n${bootstrap}\n`, "utf8"));
  }

  writeAsar(COPY_ASAR, archive);

  const verify = readAsar(COPY_ASAR);
  for (const filePath of PRELOAD_PATCH_PATHS) {
    const patched = verify.files.get(filePath)?.toString("utf8") || "";
    if (!patched.includes(MARKER)) throw new Error(`ASAR verification failed: bootstrap marker missing in ${filePath}`);
  }
}

function buildBootstrap() {
  const css = readFileSync(path.join(ROOT, "runtime", "rtl.css"), "utf8");
  const runtime = readFileSync(path.join(ROOT, "runtime", "rtl-runtime.js"), "utf8");
  const profile = mergeJsonObjects(
    readOptionalJson(path.join(ROOT, "profiles", "claude.json")),
    readOptionalJson(path.join(ROOT, "profiles", "claude.local.json")),
  );

  return `${MARKER}
(() => {
  try {
    const electron = require("electron");
    const css = ${JSON.stringify(css)};
    const runtime = ${JSON.stringify(runtime)};
    const profile = ${JSON.stringify(profile)};
    const start = () => {
      try {
        window.__LOCAL_RTL_PROFILE__ = { ...profile, diagnostics: profile.verboseDiagnostics === true };
        electron.webFrame.insertCSS(css, { cssOrigin: "author" });
        (0, eval)(runtime);
      } catch (error) {
        console.error("[RTL] Claude runtime start failed:", error);
      }
    };
    const schedule = () => {
      const run = () => setTimeout(start, 1500);
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
      else run();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  } catch (error) {
    console.error("[RTL] Claude preload bootstrap failed:", error);
  }
})();`;
}

function readOptionalJson(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function mergeJsonObjects(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override === undefined ? base : override;
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = key in base ? mergeJsonObjects(base[key], value) : value;
  }
  return output;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function updateAsarIntegrity() {
  const hash = sha256AsarHeader(COPY_ASAR);
  plistSet(COPY_PLIST, "ElectronAsarIntegrity:Resources/app.asar:algorithm", "SHA256");
  plistSet(COPY_PLIST, "ElectronAsarIntegrity:Resources/app.asar:hash", hash);
}

function signCopy() {
  writeAdhocEntitlements();
  const sign = spawnSync("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    ADHOC_ENTITLEMENTS_FILE,
    COPY_APP,
  ], { encoding: "utf8" });
  if (sign.status !== 0) {
    throw new Error(`codesign failed: ${(sign.stderr || sign.stdout).trim()}`);
  }
}

function writeAdhocEntitlements() {
  writeFileSync(ADHOC_ENTITLEMENTS_FILE, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.device.bluetooth</key>
  <true/>
  <key>com.apple.security.device.camera</key>
  <true/>
  <key>com.apple.security.device.print</key>
  <true/>
  <key>com.apple.security.device.usb</key>
  <true/>
  <key>com.apple.security.personal-information.location</key>
  <true/>
  <key>com.apple.security.personal-information.photos-library</key>
  <true/>
  <key>com.apple.security.virtualization</key>
  <true/>
</dict>
</plist>
`);
}

function verifySignature() {
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", COPY_APP], { encoding: "utf8" });
  if (verify.status !== 0) {
    throw new Error(`codesign verify failed: ${(verify.stderr || verify.stdout).trim()}`);
  }
}

function plistSet(plist, keyPath, value) {
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${keyPath} ${value}`, plist], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`PlistBuddy Set ${keyPath} failed: ${(result.stderr || result.stdout).trim()}`);
}

function plistRead(plist, keyPath) {
  const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${keyPath}`, plist], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`PlistBuddy Print ${keyPath} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function readAppVersion(appPath) {
  const bundlePath = appPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
  const plist = path.join(bundlePath, "Contents", "Info.plist");
  if (!existsSync(plist)) return "";
  const result = spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", plist], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256AsarHeader(filePath) {
  const buffer = readFileSync(filePath);
  const headerJsonSize = buffer.readUInt32LE(12);
  return createHash("sha256").update(buffer.subarray(16, 16 + headerJsonSize)).digest("hex");
}

function readAsar(filePath) {
  const buffer = readFileSync(filePath);
  const headerPickleSize = buffer.readUInt32LE(4);
  const headerJsonSize = buffer.readUInt32LE(12);
  const headerStart = 16;
  const dataStart = 8 + headerPickleSize;
  const header = JSON.parse(buffer.subarray(headerStart, headerStart + headerJsonSize).toString("utf8"));
  const files = new Map();

  walkAsarHeader(header, "", (entryPath, entry) => {
    if (entry.files || entry.link || entry.unpacked) return;
    const start = dataStart + Number(entry.offset || 0);
    files.set(entryPath, buffer.subarray(start, start + Number(entry.size || 0)));
  });

  return { header, files };
}

function writeAsar(filePath, archive) {
  let offset = 0;
  const buffers = [];
  const header = cloneAndRewriteAsarHeader(archive.header, "", archive.files, (entryPath, entry) => {
    const data = archive.files.get(entryPath);
    if (!data) throw new Error(`Missing packed data for ${entryPath}`);
    entry.size = data.length;
    entry.offset = String(offset);
    entry.integrity = buildIntegrity(data);
    offset += data.length;
    buffers.push(data);
  });

  const headerJson = Buffer.from(JSON.stringify(header), "utf8");
  const paddedHeaderSize = roundUp(headerJson.length, 4);
  const headerPickleSize = paddedHeaderSize + 8;
  const headerSizeField = paddedHeaderSize + 4;
  const metadata = Buffer.alloc(16 + paddedHeaderSize);
  metadata.writeUInt32LE(4, 0);
  metadata.writeUInt32LE(headerPickleSize, 4);
  metadata.writeUInt32LE(headerSizeField, 8);
  metadata.writeUInt32LE(headerJson.length, 12);
  headerJson.copy(metadata, 16);

  writeFileSync(filePath, Buffer.concat([metadata, ...buffers]));
}

function walkAsarHeader(node, prefix, callback) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const entryPath = prefix ? `${prefix}/${name}` : name;
    callback(entryPath, entry);
    if (entry.files) walkAsarHeader(entry, entryPath, callback);
  }
}

function cloneAndRewriteAsarHeader(node, prefix, files, onPackedFile) {
  const output = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== "files") output[key] = value;
  }
  if (!node.files) return output;

  output.files = {};
  for (const [name, entry] of Object.entries(node.files)) {
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const cloned = cloneAndRewriteAsarHeader(entry, entryPath, files, onPackedFile);
    if (!entry.files && !entry.link && !entry.unpacked) onPackedFile(entryPath, cloned);
    output.files[name] = cloned;
  }
  return output;
}

function buildIntegrity(buffer) {
  const blockSize = 4 * 1024 * 1024;
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    blocks.push(createHash("sha256").update(buffer.subarray(offset, offset + blockSize)).digest("hex"));
  }
  if (buffer.length === 0) blocks.push(createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  return {
    algorithm: "SHA256",
    hash: createHash("sha256").update(buffer).digest("hex"),
    blockSize,
    blocks,
  };
}

function roundUp(value, multiple) {
  return Math.ceil(value / multiple) * multiple;
}

function logEvent(event, details) {
  appendFileSync(LOG_FILE, `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`);
}
