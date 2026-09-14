import { cloneElement, isValidElement, type ReactNode } from 'react';
import { linkify } from './Linkify';

// Order matters: '**bold**' must be tried before '*italic*' since both start
// with '*' — split()'s regex tries alternatives left-to-right at each
// position, so listing the double-char markers first resolves the tie
// correctly instead of the single-star pattern greedily eating the pair.
const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|\*[^*\n]+\*)/g;
const LINK_SYNTAX = /^\[([^\]]+)\]\(([^)]+)\)$/;

function reKey(node: ReactNode, key: string): ReactNode {
  return isValidElement(node) ? cloneElement(node, { key }) : node;
}

function renderInline(text: string, keyPrefix: string, extra?: (segment: string) => ReactNode[]): ReactNode[] {
  const segments = text.split(INLINE_PATTERN);
  const nodes: ReactNode[] = [];

  segments.forEach((segment, index) => {
    if (!segment) return;
    const key = `${keyPrefix}-${index}`;

    if (index % 2 === 1) {
      if (segment.startsWith('**')) {
        nodes.push(<strong key={key}>{renderInline(segment.slice(2, -2), key, extra)}</strong>);
      } else if (segment.startsWith('~~')) {
        nodes.push(<s key={key}>{renderInline(segment.slice(2, -2), key, extra)}</s>);
      } else if (segment.startsWith('`')) {
        nodes.push(
          <code key={key} className="eve-richtext__code">
            {segment.slice(1, -1)}
          </code>,
        );
      } else if (segment.startsWith('[')) {
        const match = segment.match(LINK_SYNTAX);
        if (match) {
          const [, label, url] = match;
          nodes.push(
            <a
              key={key}
              href={/^https?:\/\//i.test(url!) ? url : `https://${url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="eve-link"
              onClick={(event) => event.stopPropagation()}
            >
              {label}
            </a>,
          );
        } else {
          nodes.push(segment);
        }
      } else {
        nodes.push(<em key={key}>{renderInline(segment.slice(1, -1), key, extra)}</em>);
      }
      return;
    }

    (extra ? extra(segment) : linkify(segment)).forEach((node, subIndex) => {
      nodes.push(reKey(node, `${key}-${subIndex}`));
    });
  });

  return nodes;
}

/**
 * A deliberately small Markdown subset — bold, italic, strikethrough, inline
 * code, fenced code blocks, blockquote, and links — matching exactly the syntax the selection
 * formatting toolbar inserts (see useFormattingToolbar.tsx). Nothing here
 * requires a real Markdown library: the grammar is intentionally this small.
 *
 * `extra` lets a caller compose in its own leaf-level highlighting (job
 * description client-name matches, chat @mentions) instead of the default
 * linkify()-only behavior — it always still runs on the plain-text runs
 * between formatted spans, never inside a code span.
 */
export function renderRichText(text: string, extra?: (segment: string) => ReactNode[]): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  let quoteBuffer: string[] = [];
  let codeBuffer: string[] | null = null;
  let key = 0;

  const flushQuote = () => {
    if (quoteBuffer.length === 0) return;
    const content = quoteBuffer.join('\n');
    nodes.push(
      <blockquote key={`quote-${key}`} className="eve-richtext__quote">
        {renderInline(content, `quote-${key++}`, extra)}
      </blockquote>,
    );
    quoteBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer === null) return;
    // Rendered verbatim — no inline formatting or extra() highlighting inside a code block.
    nodes.push(
      <pre key={`code-${key++}`} className="eve-richtext__pre">
        <code>{codeBuffer.join('\n')}</code>
      </pre>,
    );
    codeBuffer = null;
  };

  lines.forEach((line, index) => {
    if (codeBuffer !== null) {
      if (line.startsWith('```')) {
        flushCode();
      } else {
        codeBuffer.push(line);
      }
      return;
    }
    if (line.startsWith('```')) {
      flushQuote();
      codeBuffer = [];
      return;
    }
    if (line.startsWith('> ') || line === '>') {
      quoteBuffer.push(line.replace(/^>\s?/, ''));
      return;
    }
    flushQuote();
    nodes.push(...renderInline(line, `line-${key++}`, extra));
    if (index < lines.length - 1) nodes.push('\n');
  });
  flushQuote();
  flushCode(); // unterminated fence (e.g. still typing) — render what's there rather than dropping it

  return nodes;
}
