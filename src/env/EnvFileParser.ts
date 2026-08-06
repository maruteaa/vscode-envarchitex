export type Quote = '"' | "'" | null;

export type EnvLine =
  | {
      kind: 'kv';
      key: string;
      rawValue: string;
      quote: Quote;
      inlineComment: string | null;
      exported: boolean;
      lineNumber: number;
    }
  | { kind: 'comment'; text: string; lineNumber: number }
  | { kind: 'blank'; lineNumber: number };

export interface ParsedEnvFile {
  lines: EnvLine[];
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
}

const EXPORT_PREFIX = /^export\s+/;

export class EnvFileParser {
  parse(text: string): ParsedEnvFile {
    const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
    const trailingNewline = text.endsWith('\n');

    const stripped = trailingNewline
      ? text.slice(0, text.length - (eol === '\r\n' ? 2 : 1))
      : text;

    const rawLines = text.length === 0 ? [] : stripped.split(eol);
    const lines: EnvLine[] = rawLines.map((line, idx) => this.parseLine(line, idx + 1));

    return { lines, eol, trailingNewline };
  }

  keysOf(file: ParsedEnvFile): Set<string> {
    const out = new Set<string>();
    for (const line of file.lines) {
      if (line.kind === 'kv') {
        out.add(line.key);
      }
    }
    return out;
  }

  serialize(file: ParsedEnvFile): string {
    const body = file.lines.map((line) => this.serializeLine(line)).join(file.eol);
    if (file.lines.length === 0) {
      return file.trailingNewline ? file.eol : '';
    }
    return file.trailingNewline ? body + file.eol : body;
  }

  private parseLine(raw: string, lineNumber: number): EnvLine {
    if (raw.trim().length === 0) {
      return { kind: 'blank', lineNumber };
    }
    const leading = raw.replace(/^\s+/, '');
    if (leading.startsWith('#')) {
      return { kind: 'comment', text: raw, lineNumber };
    }

    let exported = false;
    let working = raw;
    const exportMatch = working.match(EXPORT_PREFIX);
    if (exportMatch) {
      exported = true;
      working = working.slice(exportMatch[0].length);
    }

    const eqIdx = working.indexOf('=');
    if (eqIdx === -1) {
      return { kind: 'comment', text: raw, lineNumber };
    }

    const key = working.slice(0, eqIdx).trim();
    const rest = working.slice(eqIdx + 1);

    const parsed = this.splitValueAndComment(rest);

    return {
      kind: 'kv',
      key,
      rawValue: parsed.value,
      quote: parsed.quote,
      inlineComment: parsed.inlineComment,
      exported,
      lineNumber
    };
  }

  private splitValueAndComment(rest: string): { value: string; quote: Quote; inlineComment: string | null } {
    let i = 0;
    while (i < rest.length && (rest.charAt(i) === ' ' || rest.charAt(i) === '\t')) {
      i++;
    }
    const leading = rest.slice(0, i);
    const trimmed = rest.slice(i);

    if (trimmed.length === 0) {
      return { value: leading, quote: null, inlineComment: null };
    }

    const first = trimmed.charAt(0);
    if (first === '"' || first === "'") {
      const quote: Quote = first;
      let j = 1;
      while (j < trimmed.length) {
        const c = trimmed.charAt(j);
        if (c === '\\' && j + 1 < trimmed.length) {
          j += 2;
          continue;
        }
        if (c === quote) {
          break;
        }
        j++;
      }
      const valueWithQuotes = trimmed.slice(0, j + 1);
      const after = trimmed.slice(j + 1);
      const commentIdx = after.indexOf('#');
      const inlineComment = commentIdx >= 0 ? after.slice(commentIdx) : null;
      const trailingPad = commentIdx >= 0 ? after.slice(0, commentIdx) : after;
      return {
        value: leading + valueWithQuotes + trailingPad,
        quote,
        inlineComment
      };
    }

    const commentIdx = trimmed.indexOf('#');
    if (commentIdx >= 0) {
      const valuePart = trimmed.slice(0, commentIdx);
      const inlineComment = trimmed.slice(commentIdx);
      return { value: leading + valuePart, quote: null, inlineComment };
    }
    return { value: leading + trimmed, quote: null, inlineComment: null };
  }

  private serializeLine(line: EnvLine): string {
    switch (line.kind) {
      case 'blank':
        return '';
      case 'comment':
        return line.text;
      case 'kv': {
        const prefix = line.exported ? 'export ' : '';
        const comment = line.inlineComment ? line.inlineComment : '';
        const sep = line.inlineComment && !line.rawValue.endsWith(' ') ? ' ' : '';
        return `${prefix}${line.key}=${line.rawValue}${sep}${comment}`;
      }
    }
  }
}
