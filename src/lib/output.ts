export const icon = {
  success: "\u2705",
  warning: "\u26A0\uFE0F",
  error: "\u274C",
  pending: "\u25CB",
  running: "\u2192",
  done: "\u2713",
  vault: "\uD83D\uDCE6",
  task: "\uD83D\uDCCB",
  workflow: "\uD83D\uDD04",
  search: "\uD83D\uDD0D",
  doctor: "\uD83C\uDFE5",
  init: "\u26A1",
  agent: "\uD83E\uDD16",
  config: "\u2699\uFE0F",
  git: "\uD83D\uDD00",
  tip: "\uD83D\uDCA1",
} as const;

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const columnValues = rows.map((row) => row[index]?.length ?? 0);
    return Math.max(header.length, ...columnValues);
  });

  const separator = "\u251C" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u253C") + "\u2524";
  const topBorder = "\u250C" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u252C") + "\u2510";
  const bottomBorder = "\u2514" + widths.map((w) => "\u2500".repeat(w + 2)).join("\u2534") + "\u2518";

  const formatRow = (cells: string[]) =>
    "\u2502" + cells.map((cell, i) => ` ${cell.padEnd(widths[i]!)} `).join("\u2502") + "\u2502";

  const lines: string[] = [
    topBorder,
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
    bottomBorder,
  ];

  return lines.join("\n");
}

export function progressBar(filled: number, total: number, width: number = 10): string {
  if (total === 0) return "\u2591".repeat(width);
  const filledCount = Math.round((filled / total) * width);
  return "\u2588".repeat(filledCount) + "\u2591".repeat(width - filledCount);
}

export function box(title: string, lines: string[]): string {
  const maxWidth = Math.max(title.length + 4, ...lines.map((line) => line.length + 4));
  const topBorder = `\u250C\u2500 ${title} ${ "\u2500".repeat(Math.max(0, maxWidth - title.length - 4))}\u2510`;
  const bottomBorder = `\u2514${"\u2500".repeat(maxWidth)}\u2518`;

  const formatted = lines.map((line) => `\u2502  ${line.padEnd(maxWidth - 2)}\u2502`);

  return [topBorder, ...formatted, bottomBorder].join("\n");
}

export function section(titleIcon: string, title: string): string {
  return `\n${titleIcon} ${title}`;
}

export function statusIcon(status: string): string {
  switch (status) {
    case "done": case "completed": return "\uD83D\uDFE2";
    case "in-progress": case "running": return "\uD83D\uDD35";
    case "pending": return "\u26AA";
    case "blocked": case "failed": return "\uD83D\uDD34";
    case "paused": return "\uD83D\uDFE1";
    case "review": return "\uD83D\uDFE0";
    default: return "\u26AA";
  }
}

export function stepLine(_index: number, name: string, status: string, detail: string = ""): string {
  const icons: Record<string, string> = {
    pending: "\u25CB",
    running: "\u2192",
    completed: "\u2713",
    failed: "\u2717",
    skipped: "\u2015",
  };
  const statusIcon = icons[status] ?? "\u25CB";
  const detailStr = detail ? `  ${detail}` : "";
  return `  ${statusIcon} ${name.padEnd(12)}${detailStr}`;
}

export function keyValue(key: string, value: string, keyWidth: number = 16): string {
  return `  ${key.padEnd(keyWidth)} ${value}`;
}

export function divider(char: string = "\u2500", width: number = 40): string {
  return char.repeat(width);
}
