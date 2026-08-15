import * as vscode from 'vscode';
import { EnvFileParser, type ParsedEnvFile, type EnvLine, type Quote } from './EnvFileParser.js';
import type { EnvType } from '../detection/TypeInferenceEngine.js';
import type { Settings } from '../config/Settings.js';

import * as path from 'node:path';

const HEADER = '# Added by EnvArchitex';

export interface VariableToAdd {
  key: string;
  type: EnvType;
  defaultValue?: string;
  sourceBasename?: string;
}

export interface AppendResult {
  added: string[];
  alreadyPresent: string[];
}

export class EnvExampleWriter {
  constructor(
    private readonly parser: EnvFileParser,
    private readonly settings: Settings,
    private readonly output: vscode.OutputChannel
  ) { }

  async append(uri: vscode.Uri, variables: VariableToAdd[]): Promise<AppendResult> {
    if (variables.length === 0) {
      return { added: [], alreadyPresent: [] };
    }

    const existing = await this.readOrEmpty(uri);
    const existingKeys = this.parser.keysOf(existing);

    const truly: VariableToAdd[] = [];
    const already: string[] = [];
    const seen = new Set<string>();
    for (const v of variables) {
      if (seen.has(v.key)) {
        continue;
      }
      seen.add(v.key);
      if (existingKeys.has(v.key)) {
        already.push(v.key);
      } else {
        truly.push(v);
      }
    }

    if (truly.length === 0) {
      return { added: [], alreadyPresent: already };
    }

    const isExampleFile = /\.(example|sample|template)$/i.test(uri.fsPath);
    const updated = this.appendSection(existing, truly, isExampleFile);
    const text = this.parser.serialize(updated);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));

    this.output.appendLine(
      `[writer] appended ${truly.length} variable(s) to ${vscode.workspace.asRelativePath(uri)}`
    );
    return { added: truly.map((v) => v.key), alreadyPresent: already };
  }

  private appendSection(file: ParsedEnvFile, variables: VariableToAdd[], isExampleFile: boolean): ParsedEnvFile {
    const newLines: EnvLine[] = [...file.lines];

    // Ensure main HEADER exists
    let headerIdx = -1;
    for (let i = newLines.length - 1; i >= 0; i--) {
      const line = newLines[i];
      if (line.kind === 'comment' && line.text.trim() === HEADER) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      if (newLines.length > 0 && newLines[newLines.length - 1].kind !== 'blank') {
        newLines.push({ kind: 'blank', lineNumber: newLines.length + 1 });
      }
      newLines.push({
        kind: 'comment',
        text: HEADER,
        lineNumber: newLines.length + 1
      });
    }

    // Group by sourceBasename
    const groups = new Map<string, VariableToAdd[]>();
    for (const v of variables) {
      const groupKey = v.sourceBasename || 'Other';
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(v);
    }

    for (const [sourceBasename, vars] of groups.entries()) {
      const headerText = sourceBasename !== 'Other' ? this.formatSectionHeader(sourceBasename) : '';
      const kvLines = vars.map((v) => this.makeKvLine(v, isExampleFile));

      let sectionIdx = -1;
      if (headerText) {
        for (let i = 0; i < newLines.length; i++) {
          const l = newLines[i];
          if (l.kind === 'comment' && l.text.trim() === headerText) {
            sectionIdx = i;
            break;
          }
        }
      }

      if (sectionIdx !== -1) {
        // Insert after existing section header and its kv lines
        let insertAt = sectionIdx + 1;
        while (insertAt < newLines.length && (newLines[insertAt].kind === 'kv' || newLines[insertAt].kind === 'blank')) {
          if (newLines[insertAt].kind === 'blank' && insertAt + 1 < newLines.length && newLines[insertAt + 1].kind === 'comment') {
            break;
          }
          insertAt++;
        }
        newLines.splice(insertAt, 0, ...kvLines);
      } else {
        // Append new section
        if (newLines.length > 0 && newLines[newLines.length - 1].kind !== 'blank') {
          newLines.push({ kind: 'blank', lineNumber: newLines.length + 1 });
        }
        if (headerText) {
          newLines.push({
            kind: 'comment',
            text: headerText,
            lineNumber: newLines.length + 1
          });
        }
        newLines.push(...kvLines);
      }
    }

    return {
      lines: newLines,
      eol: file.eol,
      trailingNewline: true
    };
  }

  private formatSectionHeader(sourceBasename: string): string {
    const ext = path.extname(sourceBasename).toLowerCase();
    let lang = 'General';
    if (ext === '.js') lang = 'JavaScript';
    else if (ext === '.ts') lang = 'TypeScript';
    else if (ext === '.tsx') lang = 'TSX';
    else if (ext === '.py') lang = 'Python';
    else if (ext === '.rs') lang = 'Rust';
    else if (ext === '.php') lang = 'PHP';
    else if (ext === '.go') lang = 'Go';
    else if (ext === '.rb') lang = 'Ruby';
    else if (ext === '.java') lang = 'Java';
    else if (ext === '.cs') lang = 'C#';
    else if (ext === '.cpp' || ext === '.c' || ext === '.h' || ext === '.hpp') lang = 'C++';
    
    return `# ${lang} (${sourceBasename})`;
  }

  private makeKvLine(v: VariableToAdd, isExampleFile: boolean): EnvLine {
    const isString = v.type === 'string';
    const inlineComment =
      this.settings.emitTypeComment && !isString ? `# type: ${v.type}` : null;
    
    let rawValue = '';
    let quote: Quote = null;

    if (isExampleFile) {
      rawValue = isString ? '""' : '';
      quote = isString ? '"' : null;
    } else {
      if (v.defaultValue !== undefined && v.defaultValue !== '') {
        rawValue = isString ? `"${v.defaultValue}"` : v.defaultValue;
        quote = isString ? '"' : null;
      } else {
        rawValue = isString ? '""' : '';
        quote = isString ? '"' : null;
      }
    }

    return {
      kind: 'kv',
      key: v.key,
      rawValue,
      quote,
      inlineComment,
      exported: false,
      lineNumber: 0
    };
  }

  private async readOrEmpty(uri: vscode.Uri): Promise<ParsedEnvFile> {
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(buf).toString('utf8');
      return this.parser.parse(text);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'FileNotFound' || code === 'ENOENT') {
        return this.parser.parse('');
      }
      throw err;
    }
  }
}
