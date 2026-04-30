import { buildSettingsJson } from "../lib/settings-template.js";

export function settingsTemplate(): void {
  console.log(buildSettingsJson());
}
