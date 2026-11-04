// Safe Markdown for assistant replies (#19, 19-f).
// react-markdown builds React elements from the Markdown AST; it never uses innerHTML.
// - skipHtml: raw HTML in the reply is dropped, and there is no rehype-raw, so it is never parsed.
// - rehype-sanitize (GitHub schema) still runs as a second fence on the generated tree.
// - no <img>: a reply must not make the app load remote URLs (tracking pixels); CSP blocks them too.
// - links are shown but never navigate the webview; the URL is visible as a tooltip.
import type { AnchorHTMLAttributes, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const SAFE_URL = /^(https?:|mailto:)/i;

function SafeLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  const safe = typeof href === "string" && SAFE_URL.test(href) ? href : undefined;
  return (
    <a
      href={safe}
      title={safe}
      rel="noreferrer noopener"
      onClick={(e) => e.preventDefault()}
      className="md-link"
    >
      {children}
    </a>
  );
}

const DROP = ["img", "iframe", "script", "style", "object", "embed", "form", "input"];

export function urlTransform(url: string): string {
  return SAFE_URL.test(url.trim()) ? url : "";
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        disallowedElements={DROP}
        unwrapDisallowed
        urlTransform={urlTransform}
        components={{ a: SafeLink }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
