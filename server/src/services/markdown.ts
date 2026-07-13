import MarkdownIt from 'markdown-it';

// Server-side Markdown → HTML for markdown artifacts (spec §11). The result is
// served through the sandboxed render path, so it inherits opaque-origin
// isolation; safety comes from the sandbox (spec §11), not from sanitization
// here, which is why raw HTML passthrough is allowed.
const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

export function renderMarkdownToHtml(source: string): string {
  return md.render(source);
}
