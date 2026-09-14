import type { JSX, ReactNode } from 'react';

// www.example.com still counts as a link even without a scheme — people paste
// bare domains and file links constantly and expect them to just work.
// Local filesystem paths (home-relative "~/..." or absolute "/home/...",
// "/Users/...", "C:\...") are matched by the same combined pattern so a
// single split() pass handles both — see toHref() for how each kind resolves
// to its own scheme.
const LINK_PATTERN =
  /((?:https?:\/\/|www\.)[^\s<>"']+|~(?:\/[^\s<>"']+)+|\/(?:home|Users|mnt|opt|var|etc)(?:\/[^\s<>"']+)+|[A-Za-z]:\\(?:[^\s<>"'\\]+\\)*[^\s<>"']+)/gi;

// Trailing punctuation almost always belongs to the sentence, not the URL
// (e.g. "check the file at https://x.com/a.pdf." shouldn't swallow the dot).
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * `file://` navigation from an http(s) page is blocked by every major
 * browser as a security measure — this link is still worth rendering (it
 * copy-pastes cleanly into an address bar, and some non-browser shells do
 * honor it), but clicking it in a normal browser tab will typically do
 * nothing or show a blocked-navigation warning. That's a browser limitation,
 * not a bug in this component.
 */
function toHref(match: string): string {
  if (/^https?:\/\//i.test(match)) return match;
  if (/^www\./i.test(match)) return `https://${match}`;
  if (/^[A-Za-z]:\\/.test(match)) return `file:///${match.replace(/\\/g, '/')}`;
  return `file://${match}`;
}

/**
 * Splits free text into a sequence of plain strings and `<a>` nodes for any
 * URL- or file-link-looking substring. Returns an inline node array (not
 * block elements), so it composes with the `white-space: pre-wrap`
 * containers already used for comments/notes — wrap the call in whatever
 * element already renders the text, e.g. `<p>{linkify(text)}</p>`.
 */
export function linkify(text: string): ReactNode[] {
  const segments = text.split(LINK_PATTERN);
  const nodes: ReactNode[] = [];

  segments.forEach((segment, index) => {
    // split() with a capturing group interleaves plain text (even indices)
    // with the captured matches (odd indices).
    if (index % 2 === 0) {
      if (segment) nodes.push(segment);
      return;
    }

    let match = segment;
    let trailing = '';
    const trailingMatch = match.match(TRAILING_PUNCTUATION);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      match = match.slice(0, -trailing.length);
    }

    nodes.push(
      <a
        key={index}
        href={toHref(match)}
        target="_blank"
        rel="noopener noreferrer"
        className="eve-link"
        // Some callers (e.g. the job description view) make the whole
        // container clickable-to-edit — a link click shouldn't also trigger
        // that.
        onClick={(event) => event.stopPropagation()}
      >
        {match}
      </a>,
    );
    if (trailing) nodes.push(trailing);
  });

  return nodes;
}

export function Linkify({ text }: { text: string }): JSX.Element {
  return <>{linkify(text)}</>;
}
