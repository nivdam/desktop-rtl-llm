import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadProfile(profileDir, appName) {
  const basePath = path.join(profileDir, `${appName}.json`);
  const localPath = path.join(profileDir, `${appName}.local.json`);
  const base = readJson(basePath);
  const local = existsSync(localPath) ? readJson(localPath) : {};
  const merged = resolveAppCandidate(deepMerge(base, local));

  if (existsSync(localPath) && Object.keys(local).length > 0) {
    merged.__localOverridePath = localPath;
  }

  return merged;
}

export function resolveAppCandidate(profile, pathExists = existsSync) {
  if (profile.appPath && pathExists(profile.appPath)) {
    return profile;
  }

  if (!Array.isArray(profile.appCandidates) || profile.appCandidates.length === 0) {
    return profile;
  }

  const selected = profile.appCandidates.find((candidate) => pathExists(candidate.appPath))
    ?? profile.appCandidates[0];

  return { ...profile, ...selected };
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
