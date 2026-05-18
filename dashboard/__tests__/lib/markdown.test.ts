// Tests for the dependency-free markdown renderer. The element tree is
// rendered to static markup so each syntax class can be asserted on the DOM,
// and the URL allowlist is checked against `javascript:` and raw HTML.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown, sanitizeUrl } from "@/lib/markdown";

/** Render markdown to an HTML string for assertions. */
function html(source: string): string {
  return renderToStaticMarkup(renderMarkdown(source));
}

describe("renderMarkdown — block syntax", () => {
  it("renders ATX headings at the right level", () => {
    expect(html("# Title")).toContain("<h1>Title</h1>");
    expect(html("### Sub")).toContain("<h3>Sub</h3>");
  });

  it("renders unordered lists", () => {
    const out = html("- one\n- two");
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<li>two</li>");
  });

  it("renders ordered lists", () => {
    const out = html("1. first\n2. second");
    expect(out).toContain("<ol>");
    expect(out).toContain("<li>first</li>");
  });

  it("renders fenced code blocks verbatim", () => {
    const out = html("```\nconst x = 1;\n```");
    expect(out).toContain("<pre><code>const x = 1;</code></pre>");
  });

  it("renders blockquotes", () => {
    const out = html("> quoted line");
    expect(out).toContain("<blockquote>quoted line</blockquote>");
  });

  it("renders GFM tables with a header and body", () => {
    const out = html("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>A</th>");
    expect(out).toContain("<td>1</td>");
  });

  it("renders paragraphs", () => {
    expect(html("plain text")).toContain("<p>plain text</p>");
  });
});

describe("renderMarkdown — inline syntax", () => {
  it("renders bold and italic", () => {
    expect(html("**bold** text")).toContain("<strong>bold</strong>");
    expect(html("*italic* text")).toContain("<em>italic</em>");
  });

  it("renders inline code", () => {
    expect(html("a `snippet` here")).toContain("<code>snippet</code>");
  });

  it("renders safe links as anchors", () => {
    const out = html("[docs](https://example.com)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain(">docs</a>");
  });
});

describe("renderMarkdown — security", () => {
  it("renders a javascript: link as plain text, not an anchor", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).not.toContain("<a");
    expect(out).toContain("click");
  });

  it("escapes raw HTML in the source", () => {
    const out = html("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("sanitizeUrl", () => {
  it("allows http, https, and mailto", () => {
    expect(sanitizeUrl("https://x.com")).toBe("https://x.com");
    expect(sanitizeUrl("http://x.com")).toBe("http://x.com");
    expect(sanitizeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("allows same-origin paths and fragments", () => {
    expect(sanitizeUrl("/vault")).toBe("/vault");
    expect(sanitizeUrl("#section")).toBe("#section");
  });

  it("rejects javascript: and data: schemes", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("data:text/html,<script>")).toBeNull();
  });
});
