import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectContext } from "../lib/context.js";

export function config(args: string[]): void {
  const context = detectContext();
  if (!context) {
    console.error("Not a git repository.");
    process.exitCode = 1;
    return;
  }

  const settingsPath = join(context.projectRoot, ".claude", "settings.json");
  const subcommand = args[0];

  switch (subcommand) {
    case "get":
      configGet(settingsPath, args[1]);
      break;
    case "set":
      configSet(settingsPath, args[1], args[2]);
      break;
    case "show":
      configShow(settingsPath);
      break;
    default:
      console.error("Usage: dev-workflow config get|set|show");
      console.error("  config show              Show full settings");
      console.error("  config get <key.path>    Get a config value");
      console.error("  config set <key.path> <value>  Set a config value");
      process.exitCode = 1;
  }
}

function loadSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    console.error("Settings not found. Run 'dev-workflow init'.");
    process.exitCode = 1;
    return {};
  }
  return JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
}

function getNestedValue(object: Record<string, unknown>, keyPath: string): unknown {
  const keys = keyPath.split(".");
  let current: unknown = object;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function setNestedValue(object: Record<string, unknown>, keyPath: string, value: unknown): void {
  const keys = keyPath.split(".");
  let current: Record<string, unknown> = object;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]!] = value;
}

function configGet(settingsPath: string, keyPath: string | undefined): void {
  if (!keyPath) {
    console.error("Usage: dev-workflow config get <key.path>");
    process.exitCode = 1;
    return;
  }

  const settings = loadSettings(settingsPath);
  const value = getNestedValue(settings, keyPath);

  if (value === undefined) {
    console.error(`Key not found: ${keyPath}`);
    process.exitCode = 1;
  } else {
    console.log(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
  }
}

function configSet(settingsPath: string, keyPath: string | undefined, rawValue: string | undefined): void {
  if (!keyPath || rawValue === undefined) {
    console.error("Usage: dev-workflow config set <key.path> <value>");
    process.exitCode = 1;
    return;
  }

  const settings = loadSettings(settingsPath);

  let parsedValue: unknown = rawValue;
  if (rawValue === "true") parsedValue = true;
  else if (rawValue === "false") parsedValue = false;
  else if (/^\d+$/.test(rawValue)) parsedValue = parseInt(rawValue, 10);

  setNestedValue(settings, keyPath, parsedValue);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  console.log(`Set ${keyPath} = ${JSON.stringify(parsedValue)}`);
}

function configShow(settingsPath: string): void {
  const settings = loadSettings(settingsPath);
  console.log(JSON.stringify(settings, null, 2));
}
