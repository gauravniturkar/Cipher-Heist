/**
 * Tokeniser for the Python subset.
 *
 * Produces INDENT/DEDENT/NEWLINE tokens like CPython so the parser can be a
 * plain recursive-descent parser rather than the indentation-sniffing regex
 * soup the first version of this game used.
 */

import { PySyntaxError } from './errors.js';

export type TokenType =
  | 'number'
  | 'string'
  | 'fstring'
  | 'name'
  | 'keyword'
  | 'op'
  | 'newline'
  | 'indent'
  | 'dedent'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

export const KEYWORDS = new Set([
  'and', 'break', 'continue', 'def', 'elif', 'else', 'False', 'for', 'if', 'in',
  'is', 'None', 'not', 'or', 'pass', 'return', 'True', 'while',
]);

// Longest first: `**` must win over `*`, `==` over `=`.
const OPERATORS = [
  '**=', '//=', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=',
  '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', '{', '}', ',', ':', '.',
];

const MAX_SOURCE_LENGTH = 20_000;

export function tokenize(source: string): Token[] {
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new PySyntaxError(`program too long (${source.length} characters)`, 1);
  }

  const tokens: Token[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const indents: number[] = [0];
  // Bracket depth: inside brackets, newlines and indentation are insignificant.
  let depth = 0;

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo] as string;
    const line = lineNo + 1;

    if (depth === 0) {
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const indentWidth = measureIndent(raw, line);
      const top = indents[indents.length - 1] as number;
      if (indentWidth > top) {
        indents.push(indentWidth);
        tokens.push({ type: 'indent', value: '', line, col: 0 });
      } else if (indentWidth < top) {
        while ((indents[indents.length - 1] as number) > indentWidth) {
          indents.pop();
          tokens.push({ type: 'dedent', value: '', line, col: 0 });
        }
        if ((indents[indents.length - 1] as number) !== indentWidth) {
          throw new PySyntaxError('unindent does not match any outer indentation level', line);
        }
      }
    }

    let i = depth === 0 ? countLeadingWhitespace(raw) : 0;

    while (i < raw.length) {
      const ch = raw[i] as string;

      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '#') break;

      // Line continuation.
      if (ch === '\\' && i === raw.length - 1) { i++; continue; }

      // Strings, including f-strings.
      if (ch === '"' || ch === "'") {
        const { value, next } = readString(raw, i, line);
        tokens.push({ type: 'string', value, line, col: i });
        i = next;
        continue;
      }
      if ((ch === 'f' || ch === 'F') && (raw[i + 1] === '"' || raw[i + 1] === "'")) {
        const { value, next } = readString(raw, i + 1, line);
        tokens.push({ type: 'fstring', value, line, col: i });
        i = next;
        continue;
      }

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(raw[i + 1] ?? ''))) {
        let j = i;
        while (j < raw.length && /[0-9_.]/.test(raw[j] as string)) j++;
        const value = (raw.slice(i, j) as string).replace(/_/g, '');
        if ((value.match(/\./g) ?? []).length > 1) {
          throw new PySyntaxError(`invalid number literal '${value}'`, line);
        }
        tokens.push({ type: 'number', value, line, col: i });
        i = j;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < raw.length && /[A-Za-z0-9_]/.test(raw[j] as string)) j++;
        const value = raw.slice(i, j);
        tokens.push({ type: KEYWORDS.has(value) ? 'keyword' : 'name', value, line, col: i });
        i = j;
        continue;
      }

      const op = OPERATORS.find((candidate) => raw.startsWith(candidate, i));
      if (op) {
        if ('([{'.includes(op)) depth++;
        else if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
        tokens.push({ type: 'op', value: op, line, col: i });
        i += op.length;
        continue;
      }

      throw new PySyntaxError(`unexpected character '${ch}'`, line);
    }

    if (depth === 0) tokens.push({ type: 'newline', value: '', line, col: raw.length });
  }

  if (depth > 0) throw new PySyntaxError('unclosed bracket - check your ( [ pairs', lines.length);

  const lastLine = lines.length;
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: 'dedent', value: '', line: lastLine, col: 0 });
  }
  tokens.push({ type: 'eof', value: '', line: lastLine, col: 0 });
  return tokens;
}

function countLeadingWhitespace(raw: string): number {
  let i = 0;
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++;
  return i;
}

/** Tabs count as 4, matching what a beginner's editor shows them. */
function measureIndent(raw: string, line: number): number {
  let width = 0;
  for (const ch of raw) {
    if (ch === ' ') width++;
    else if (ch === '\t') width += 4;
    else break;
  }
  if (/^[ ]*\t[ ]*\t*[^\s]/.test(raw) && raw.includes(' \t')) {
    throw new PySyntaxError('inconsistent use of tabs and spaces in indentation', line);
  }
  return width;
}

/** Reads a quoted string starting at `start`; returns the decoded contents. */
function readString(raw: string, start: number, line: number): { value: string; next: number } {
  const quote = raw[start] as string;
  let i = start + 1;
  let value = '';
  while (i < raw.length) {
    const ch = raw[i] as string;
    if (ch === '\\') {
      const escaped = raw[i + 1];
      if (escaped === undefined) break;
      value += decodeEscape(escaped);
      i += 2;
      continue;
    }
    if (ch === quote) return { value, next: i + 1 };
    value += ch;
    i++;
  }
  throw new PySyntaxError('unterminated string literal - is a quote missing?', line);
}

function decodeEscape(ch: string): string {
  switch (ch) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case '0': return '\0';
    case '\\': return '\\';
    default: return ch;
  }
}
