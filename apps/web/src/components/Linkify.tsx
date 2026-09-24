import type { ReactNode } from 'react';

// www.example.com still counts as a link even without a scheme — people paste
// bare domains constantly and expect them to just work.
//
// Local filesystem paths ("~/...", "/home/...", "C:\...") used to be matched
// here too and rendered as file:// links. Every major browser blocks file://
// navigation from an http(s) page, so those links did nothing when clicked —
// they only looked like links. Dropping them means a path now renders as the
// plain text it is, which is copy-pasteable and honest, instead of an
// affordance that never worked.
const LINK_PATTERN = /((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

// Trailing punctuation almost always belongs to the sentence, not the URL
// (e.g. "check the file at https://x.com/a.pdf." shouldn't swallow the dot).
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function toHref(match: string): string {
  return /^https?:\/\//i.test(match) ? match : `https://${match}`;
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
