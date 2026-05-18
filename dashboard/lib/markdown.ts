// Dependency-free markdown renderer — produces React nodes, never an HTML
// string, so there is no `dangerouslySetInnerHTML` surface. Supports the
// syntax classes task-056 needs: ATX headings, ordered/unordered lists,
// fenced code blocks, GFM tables, blockquotes, paragraphs, and inline
// bold/italic/code/links. Link URLs pass a scheme allowlist (`sanitizeUrl`):
// a rejected scheme renders as plain text, never an anchor.

import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^```/;
const UNORDERED_ITEM = /^[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;
const SAFE_URL_SCHEME = /^(https?:|mailto:)/i;

/** Render markdown `source` as a single React element tree. */
export function renderMarkdown(source: string): ReactElement {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    cursor = consumeBlock(lines, cursor, blocks);
  }
  return createElement(Fragment, null, ...blocks);
}

/** Consume the block starting at `index`, push its node, return the next index. */
function consumeBlock(lines: string[], index: number, out: ReactNode[]): number {
  const line = lines[index] ?? "";
  if (line.trim() === "") return index + 1;
  if (FENCE.test(line)) return consumeFence(lines, index, out);
  if (HEADING.test(line)) return consumeHeading(line, index, out);
  if (BLOCKQUOTE.test(line)) return consumeBlockquote(lines, index, out);
  if (isTableStart(lines, index)) return consumeTable(lines, index, out);
  if (UNORDERED_ITEM.test(line) || ORDERED_ITEM.test(line)) {
    return consumeList(lines, index, out);
  }
  return consumeParagraph(lines, index, out);
}

function consumeHeading(line: string, index: number, out: ReactNode[]): number {
  const match = HEADING.exec(line)!;
  const level = match[1]!.length;
  out.push(
    createElement(`h${level}`, { key: index }, ...renderInline(match[2]!.trim())),
  );
  return index + 1;
}

function consumeFence(lines: string[], index: number, out: ReactNode[]): number {
  const body: string[] = [];
  let cursor = index + 1;
  while (cursor < lines.length && !FENCE.test(lines[cursor] ?? "")) {
    body.push(lines[cursor] ?? "");
    cursor += 1;
  }
  out.push(
    createElement("pre", { key: index }, createElement("code", null, body.join("\n"))),
  );
  return cursor < lines.length ? cursor + 1 : cursor;
}

function consumeBlockquote(lines: string[], index: number, out: ReactNode[]): number {
  const body: string[] = [];
  let cursor = index;
  while (cursor < lines.length && BLOCKQUOTE.test(lines[cursor] ?? "")) {
    body.push(BLOCKQUOTE.exec(lines[cursor] ?? "")![1]!);
    cursor += 1;
  }
  out.push(
    createElement("blockquote", { key: index }, ...renderInline(body.join(" "))),
  );
  return cursor;
}

function consumeList(lines: string[], index: number, out: ReactNode[]): number {
  const ordered = ORDERED_ITEM.test(lines[index] ?? "");
  const matcher = ordered ? ORDERED_ITEM : UNORDERED_ITEM;
  const items: ReactNode[] = [];
  let cursor = index;
  while (cursor < lines.length && matcher.test(lines[cursor] ?? "")) {
    const text = matcher.exec(lines[cursor] ?? "")![1]!;
    items.push(createElement("li", { key: cursor }, ...renderInline(text)));
    cursor += 1;
  }
  out.push(createElement(ordered ? "ol" : "ul", { key: index }, ...items));
  return cursor;
}

/** A table starts when a `|`-row is immediately followed by a separator row. */
function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return header.includes("|") && TABLE_SEPARATOR.test(separator.trim());
}

function splitRow(row: string): string[] {
  return row
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function consumeTable(lines: string[], index: number, out: ReactNode[]): number {
  const headerCells = splitRow(lines[index] ?? "");
  let cursor = index + 2;
  const bodyRows: ReactNode[] = [];
  while (cursor < lines.length && (lines[cursor] ?? "").includes("|")) {
    bodyRows.push(renderTableRow(splitRow(lines[cursor] ?? ""), "td", cursor));
    cursor += 1;
  }
  out.push(
    createElement(
      "table",
      { key: index },
      createElement("thead", null, renderTableRow(headerCells, "th", index)),
      createElement("tbody", null, ...bodyRows),
    ),
  );
  return cursor;
}

function renderTableRow(cells: string[], tag: "th" | "td", rowKey: number): ReactElement {
  return createElement(
    "tr",
    { key: rowKey },
    ...cells.map((cell, column) =>
      createElement(tag, { key: column }, ...renderInline(cell)),
    ),
  );
}

function consumeParagraph(lines: string[], index: number, out: ReactNode[]): number {
  const body: string[] = [];
  let cursor = index;
  while (cursor < lines.length && isParagraphLine(lines, cursor)) {
    body.push(lines[cursor] ?? "");
    cursor += 1;
  }
  out.push(createElement("p", { key: index }, ...renderInline(body.join(" "))));
  return cursor;
}

/** A line continues a paragraph when it is non-blank and starts no other block. */
function isParagraphLine(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  if (line.trim() === "") return false;
  if (FENCE.test(line) || HEADING.test(line) || BLOCKQUOTE.test(line)) return false;
  if (UNORDERED_ITEM.test(line) || ORDERED_ITEM.test(line)) return false;
  return !isTableStart(lines, index);
}

// ── inline ───────────────────────────────────────────────────────────────────

/** Tokenize one line of text into React nodes (bold/italic/code/link/text). */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (match === null || match.index === undefined) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    nodes.push(renderToken(match[0], key));
    key += 1;
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}

function renderToken(token: string, key: number): ReactNode {
  if (token.startsWith("**")) {
    return createElement("strong", { key }, token.slice(2, -2));
  }
  if (token.startsWith("*")) {
    return createElement("em", { key }, token.slice(1, -1));
  }
  if (token.startsWith("`")) {
    return createElement("code", { key }, token.slice(1, -1));
  }
  return renderLink(token, key);
}

function renderLink(token: string, key: number): ReactNode {
  const match = LINK.exec(token);
  if (match === null) return token;
  const label = match[1]!;
  const href = sanitizeUrl(match[2]!);
  if (href === null) return label;
  return createElement("a", { key, href, rel: "noreferrer noopener" }, label);
}

/**
 * Return `url` when its scheme is allowlisted, otherwise `null`. Absolute
 * (`http(s)`/`mailto`) and same-origin (`/`, `#`) targets pass; anything
 * else — notably `javascript:` and `data:` — is rejected so the caller
 * renders the link as plain text.
 */
export function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  if (SAFE_URL_SCHEME.test(trimmed)) return trimmed;
  return null;
}
