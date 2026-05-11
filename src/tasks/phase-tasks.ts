import { readFileSync, existsSync } from "node:fs";
import type { TaskManager } from "./manager.js";

export interface PhaseTaskResult {
  created: string[];
  skipped: string[];
}

export function parseTasksFromPhase(phaseFilePath: string): string[] {
  if (!existsSync(phaseFilePath)) {
    throw new Error(`Phase file not found: ${phaseFilePath}`);
  }

  const content = readFileSync(phaseFilePath, "utf-8");
  // Terminator is the FIRST of: next ## section, a horizontal --- divider,
  // or end-of-input ($). Without the `m` flag, `$` matches end-of-string
  // (or just before a trailing newline) in JS regex — replaces the previous
  // `\Z` which is not a JS regex anchor and silently matched literal `Z`,
  // causing phase files without a trailing section/divider to parse as empty.
  const tasksMatch = content.match(/## Tasks\n([\s\S]*?)(?=\n## |\n---|$)/);
  if (!tasksMatch) return [];

  const tasksSection = tasksMatch[1]!;
  return tasksSection
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function createTasksFromPhase(
  phaseFilePath: string,
  taskManager: TaskManager,
): PhaseTaskResult {
  const taskTitles = parseTasksFromPhase(phaseFilePath);
  const existingTasks = taskManager.list();
  const existingTitles = existingTasks.map((t) => t.title.toLowerCase());

  const created: string[] = [];
  const skipped: string[] = [];

  for (const title of taskTitles) {
    const alreadyExists = existingTitles.some(
      (existing) => existing.includes(title.toLowerCase().slice(0, 20))
        || title.toLowerCase().includes(existing.slice(0, 20)),
    );

    if (alreadyExists) {
      skipped.push(title);
    } else {
      taskManager.create(title, "");
      created.push(title);
    }
  }

  return { created, skipped };
}
