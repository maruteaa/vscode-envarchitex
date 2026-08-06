import * as vscode from 'vscode';
import { EnvFileParser, type ParsedEnvFile, type EnvLine } from './EnvFileParser.js';
import type { EnvType } from '../detection/TypeInferenceEngine.js';
import type { Settings } from '../config/Settings.js';

const HEADER = '# Added by EnvArchitex';

export interface VariableToAdd {
  key: string;
  type: EnvType;
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

    const updated = this.appendSection(existing, truly);
    const text = this.parser.serialize(updated);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));

    this.output.appendLine(
      `[writer] appended ${truly.length} variable(s) to ${vscode.workspace.asRelativePath(uri)}`
    );
    return { added: truly.map((v) => v.key), alreadyPresent: already };
  }

  private appendSection(file: ParsedEnvFile, variables: VariableToAdd[]): ParsedEnvFile {
    const newLines: EnvLine[] = [...file.lines];
    const kvLines = variables.map((v) => this.makeKvLine(v));

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
      newLines.push(...kvLines);
    } else {
      let insertAt = headerIdx + 1;
      while (insertAt < newLines.length && newLines[insertAt].kind === 'kv') {
        insertAt++;
      }
      newLines.splice(insertAt, 0, ...kvLines);
    }

    return {
      lines: newLines,
      eol: file.eol,
      trailingNewline: true
    };
  }

  private makeKvLine(v: VariableToAdd): EnvLine {
    const isString = v.type === 'string';
    const inlineComment =
      this.settings.emitTypeComment && !isString ? `# type: ${v.type}` : null;
    return {
      kind: 'kv',
      key: v.key,
      rawValue: isString ? '""' : '',
      quote: isString ? '"' : null,
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
