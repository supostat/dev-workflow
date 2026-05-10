// Pure value-parsers for communication.yaml field values.
// Each throws Error("<file>:<line>: ...") on invalid input.

export function parseEnum(
  value: string,
  valid: ReadonlySet<string>,
  fieldName: string,
  profileName: string,
  filePath: string,
  lineNum: number,
): string {
  if (!valid.has(value)) {
    const validList = [...valid].join(", ");
    throw new Error(
      `${filePath}:${lineNum}: invalid ${fieldName} '${value}' in profile '${profileName}' — valid: ${validList}`,
    );
  }
  return value;
}

export function parseBoolean(
  value: string,
  fieldName: string,
  filePath: string,
  lineNum: number,
): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    `${filePath}:${lineNum}: invalid boolean '${value}' for field '${fieldName}' — must be 'true' or 'false'`,
  );
}

export function parseInlineArray(
  value: string,
  fieldName: string,
  filePath: string,
  lineNum: number,
): string[] {
  const match = value.match(/^\[(.*)\]\s*$/);
  if (!match) {
    throw new Error(
      `${filePath}:${lineNum}: field '${fieldName}' must use inline array syntax [a, b, c]`,
    );
  }
  return match[1]!
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}
