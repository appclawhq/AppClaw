/**
 * Minimal syntax highlighter for the code shown in `OutputDialog` (/yaml,
 * /preview, /export).
 *
 * Hand-rolled rather than pulling in a highlighter dependency: the only
 * languages we ever render are the two we generate ourselves (a runner spec
 * and a YAML flow), and a full grammar would be far more machinery than a
 * read-only preview needs. It is a scanner, not a parser — it can't be
 * confused into crashing on odd input, worst case a token is mis-coloured.
 */

import { COLORS } from '../ui/ink/theme.js';

export type Language = 'ts' | 'yaml';

export interface Segment {
  text: string;
  color?: string;
  bold?: boolean;
}

const PALETTE = {
  comment: COLORS.dimmed,
  string: COLORS.green,
  number: COLORS.yellow,
  keyword: COLORS.brand,
  builtin: COLORS.step,
  punct: COLORS.label,
  plain: COLORS.white,
  key: COLORS.step,
};

const KEYWORDS = new Set([
  'import',
  'export',
  'from',
  'as',
  'default',
  'const',
  'let',
  'var',
  'function',
  'return',
  'async',
  'await',
  'new',
  'class',
  'extends',
  'implements',
  'interface',
  'type',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'typeof',
  'instanceof',
  'in',
  'of',
  'this',
  'super',
  'void',
  'delete',
  'yield',
  'static',
  'public',
  'private',
  'protected',
  'readonly',
  'null',
  'undefined',
  'true',
  'false',
]);

/** Not language keywords, but the runner/AppClaw vocabulary these files are built from. */
const BUILTINS = new Set([
  'describe',
  'it',
  'test',
  'expect',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'AppClaw',
  'app',
  'process',
  'console',
]);

function wordSegment(word: string): Segment {
  if (KEYWORDS.has(word)) return { text: word, color: PALETTE.keyword, bold: true };
  if (BUILTINS.has(word)) return { text: word, color: PALETTE.builtin };
  return { text: word, color: PALETTE.plain };
}

/**
 * TypeScript/JavaScript. Block-comment state carries across lines, so this
 * takes the whole body — the generated specs open with a multi-line JSDoc
 * banner that would otherwise only colour its first line.
 */
function highlightTs(lines: string[]): Segment[][] {
  let inBlockComment = false;

  return lines.map((line) => {
    const segments: Segment[] = [];
    let word = '';
    let i = 0;

    const flushWord = () => {
      if (word) {
        segments.push(wordSegment(word));
        word = '';
      }
    };

    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf('*/', i);
        const stop = end === -1 ? line.length : end + 2;
        segments.push({ text: line.slice(i, stop), color: PALETTE.comment });
        i = stop;
        if (end !== -1) inBlockComment = false;
        continue;
      }

      const pair = line.slice(i, i + 2);
      if (pair === '/*') {
        flushWord();
        inBlockComment = true;
        continue;
      }
      if (pair === '//') {
        flushWord();
        segments.push({ text: line.slice(i), color: PALETTE.comment });
        i = line.length;
        continue;
      }

      const ch = line[i];

      if (ch === '"' || ch === "'" || ch === '`') {
        flushWord();
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === '\\') {
            j += 2;
            continue;
          }
          if (line[j] === ch) {
            j += 1;
            break;
          }
          j += 1;
        }
        segments.push({ text: line.slice(i, j), color: PALETTE.string });
        i = j;
        continue;
      }

      if (/[A-Za-z_$]/.test(ch)) {
        word += ch;
        i += 1;
        continue;
      }
      // A digit only starts a number when it isn't part of an identifier.
      if (/[0-9]/.test(ch) && !word) {
        let j = i;
        while (j < line.length && /[0-9._]/.test(line[j])) j += 1;
        segments.push({ text: line.slice(i, j), color: PALETTE.number });
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        word += ch;
        i += 1;
        continue;
      }

      flushWord();
      segments.push({ text: ch, color: PALETTE.punct });
      i += 1;
    }

    flushWord();
    return segments;
  });
}

/** YAML: comments, `key:`, list dashes, quoted scalars. */
function highlightYaml(lines: string[]): Segment[][] {
  return lines.map((line) => {
    const segments: Segment[] = [];

    const commentAt = line.indexOf('#');
    const code = commentAt === -1 ? line : line.slice(0, commentAt);
    const comment = commentAt === -1 ? '' : line.slice(commentAt);

    if (code.trim() === '---') {
      segments.push({ text: code, color: PALETTE.comment });
    } else {
      // Leading indent + optional "- " marker, then an optional "key:".
      const structure = code.match(/^(\s*)(-\s+)?([A-Za-z_][\w.-]*)(:)(.*)$/);
      if (structure) {
        const [, indent, dash, key, colon, rest] = structure;
        if (indent) segments.push({ text: indent });
        if (dash) segments.push({ text: dash, color: PALETTE.punct });
        segments.push({ text: key, color: PALETTE.key });
        segments.push({ text: colon, color: PALETTE.punct });
        if (rest) segments.push(...yamlScalar(rest));
      } else {
        const listItem = code.match(/^(\s*)(-\s+)(.*)$/);
        if (listItem) {
          const [, indent, dash, rest] = listItem;
          if (indent) segments.push({ text: indent });
          segments.push({ text: dash, color: PALETTE.punct });
          segments.push(...yamlScalar(rest));
        } else if (code) {
          segments.push(...yamlScalar(code));
        }
      }
    }

    if (comment) segments.push({ text: comment, color: PALETTE.comment });
    return segments;
  });
}

/** A YAML value: quoted strings and bare numbers get their own colour. */
function yamlScalar(text: string): Segment[] {
  const quoted = text.match(/^(\s*)(["'].*["'])(\s*)$/);
  if (quoted) {
    const [, lead, body, trail] = quoted;
    return [
      ...(lead ? [{ text: lead }] : []),
      { text: body, color: PALETTE.string },
      ...(trail ? [{ text: trail }] : []),
    ];
  }
  if (/^\s*-?\d[\d._]*\s*$/.test(text)) return [{ text, color: PALETTE.number }];
  return [{ text, color: PALETTE.plain }];
}

/** Colour a whole body. Unknown languages fall through to plain text. */
export function highlight(lines: string[], language?: Language): Segment[][] {
  if (language === 'ts') return highlightTs(lines);
  if (language === 'yaml') return highlightYaml(lines);
  return lines.map((line) => [{ text: line }]);
}
