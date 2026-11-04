import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "../src/chat/Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown (19-f)", () => {
  it("renders GFM: headings, lists, code, tables, strikethrough", () => {
    const out = html("# 标题\n\n- 一\n- 二\n\n`code`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~删~~");
    expect(out).toContain("<h1>标题</h1>");
    expect(out).toContain("<li>一</li>");
    expect(out).toContain("<code>code</code>");
    expect(out).toContain("<table>");
    expect(out).toContain("<del>删</del>");
  });

  it("never emits raw HTML, scripts or event handlers (XSS does not execute)", () => {
    const attacks = [
      "<script>alert(1)</script>",
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">x</a>',
      '<iframe src="https://evil.example"></iframe>',
      "<svg onload=alert(1)>",
      '<div style="background:url(javascript:alert(1))">x</div>',
      "[click](javascript:alert(1))",
      "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
      "![pixel](https://tracker.example/p.png)",
      '<details open ontoggle="alert(1)">x</details>',
    ];
    for (const a of attacks) {
      const out = html(a);
      expect(out, a).not.toMatch(/<script|<img|<iframe|<svg|<div style|<details/i);
      expect(out, a).not.toMatch(/\son[a-z]+=/i);
      expect(out, a).not.toMatch(/javascript:|data:text/i);
      expect(out, a).not.toContain("tracker.example");
    }
  });

  it("shows http links without letting them navigate (no target, URL visible)", () => {
    const out = html("[官网](https://example.com/a?b=1)");
    expect(out).toContain('href="https://example.com/a?b=1"');
    expect(out).toContain('title="https://example.com/a?b=1"');
    expect(out).not.toContain("target=");
  });

  it("renders a 10k-character reply quickly", () => {
    const block = "## 小节\n\n这是一段比较长的回答，包含 **加粗**、`代码` 和 [链接](https://example.com)。\n\n- 列表项一\n- 列表项二\n\n";
    const text = block.repeat(Math.ceil(10_000 / block.length)).slice(0, 10_000);
    expect(text.length).toBe(10_000);
    html(text); // warm up
    const t0 = performance.now();
    const out = html(text);
    const ms = performance.now() - t0;
    expect(out).toContain("<h2>小节</h2>");
    expect(ms).toBeLessThan(500);
  });
});
