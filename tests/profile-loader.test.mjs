import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppCandidate } from "../profile-loader.mjs";

const profile = {
  name: "codex",
  appCandidates: [
    { appName: "ChatGPT", appPath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", launchStrategy: "direct" },
    { appName: "Codex", appPath: "/Applications/Codex.app/Contents/MacOS/Codex", launchStrategy: "bundle" },
  ],
};

test("prefers the new ChatGPT desktop app", () => {
  const resolved = resolveAppCandidate(profile, (appPath) => appPath.includes("ChatGPT.app"));

  assert.equal(resolved.appName, "ChatGPT");
  assert.equal(resolved.appPath, "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT");
  assert.equal(resolved.launchStrategy, "direct");
});

test("falls back to the legacy Codex app", () => {
  const resolved = resolveAppCandidate(profile, (appPath) => appPath.includes("Codex.app"));

  assert.equal(resolved.appName, "Codex");
  assert.equal(resolved.appPath, "/Applications/Codex.app/Contents/MacOS/Codex");
  assert.equal(resolved.launchStrategy, "bundle");
});

test("preserves an explicit existing app path override", () => {
  const override = { ...profile, appPath: "/Custom/ChatGPT", launchStrategy: "direct" };
  const resolved = resolveAppCandidate(override, (appPath) => appPath === "/Custom/ChatGPT");

  assert.equal(resolved.appPath, "/Custom/ChatGPT");
  assert.equal(resolved.launchStrategy, "direct");
});
