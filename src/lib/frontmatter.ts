export interface Frontmatter {
  fields: Record<string, string | string[]>;
  body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) {
    return { fields: {}, body: raw };
  }

  const yamlBlock = match[1];
  const fields: Record<string, string | string[]> = {};

  for (const line of yamlBlock.split("\n")) {
    const fieldMatch = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (!fieldMatch) continue;

    const key = fieldMatch[1]!;
    const value = fieldMatch[2]!.trim();

    const arrayMatch = value.match(/^\[(.*)]\s*$/);
    if (arrayMatch) {
      fields[key] = arrayMatch[1]!
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      fields[key] = value;
    }
  }

  const bodyStart = raw.indexOf("---", 3);
  const body = bodyStart !== -1 ? raw.slice(bodyStart + 3).replace(/^\n+/, "") : "";

  return { fields, body };
}

export function serializeFrontmatter(fields: Record<string, unknown>, body: string): string {
  const lines: string[] = ["---"];

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  lines.push("---");

  if (body) {
    lines.push("", body);
  }

  return lines.join("\n") + "\n";
}
