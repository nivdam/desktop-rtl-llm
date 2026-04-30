#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const APPLICATIONS_DIR = path.join(HOME, "Applications");
const NODE_BIN = process.execPath;

const LAUNCHERS = [
  {
    name: "Claude RTL Launcher",
    target: "claude",
    sourceApp: "/Applications/Claude.app",
    iconName: "claude",
  },
  {
    name: "Codex RTL Launcher",
    target: "codex",
    sourceApp: "/Applications/Codex.app",
    iconName: "codex",
  },
];

main();

function main() {
  mkdirSync(APPLICATIONS_DIR, { recursive: true });

  for (const launcher of LAUNCHERS) {
    createLauncher(launcher);
  }

  registerLaunchers();
  console.log("Launchers ready:");
  for (const launcher of LAUNCHERS) {
    console.log(`  ${launcherPath(launcher)}`);
  }
}

function createLauncher(launcher) {
  assertAppExists(launcher.sourceApp);

  const appPath = launcherPath(launcher);
  const script = [
    "try",
    `do shell script ${appleScriptString(`cd ${shellQuote(ROOT)} && NODE_BIN=${shellQuote(NODE_BIN)} ./run-rtl.sh ${launcher.target}`)}`,
    "on error errMsg number errNum",
    `display dialog ${appleScriptString(`${launcher.name} failed:`)} & return & errMsg buttons {"OK"} default button "OK" with icon stop`,
    "end try",
  ];

  run("osacompile", ["-o", appPath, ...script.flatMap((line) => ["-e", line])]);
  installIcon(launcher, appPath);
  touch(appPath);
}

function installIcon(launcher, appPath) {
  const sourceIcon = readIconPath(launcher.sourceApp);
  const resourcesDir = path.join(appPath, "Contents", "Resources");
  const targetIcon = path.join(resourcesDir, `${launcher.iconName}.icns`);

  mkdirSync(resourcesDir, { recursive: true });
  copyFileSync(sourceIcon, targetIcon);

  const plist = path.join(appPath, "Contents", "Info.plist");
  run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleIconFile ${launcher.iconName}`, plist]);
  run("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleIconName ${launcher.iconName}`, plist]);
}

function readIconPath(appPath) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  const iconName = run("plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist]).stdout.trim();
  const iconFile = iconName.endsWith(".icns") ? iconName : `${iconName}.icns`;
  const iconPath = path.join(appPath, "Contents", "Resources", iconFile);
  if (!existsSync(iconPath)) throw new Error(`Icon not found: ${iconPath}`);
  return iconPath;
}

function registerLaunchers() {
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  run(lsregister, ["-f", ...LAUNCHERS.map(launcherPath)]);
}

function launcherPath(launcher) {
  return path.join(APPLICATIONS_DIR, `${launcher.name}.app`);
}

function assertAppExists(appPath) {
  if (!existsSync(appPath)) throw new Error(`Required app not found: ${appPath}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function touch(filePath) {
  const now = new Date();
  utimesSync(filePath, now, now);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appleScriptString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
