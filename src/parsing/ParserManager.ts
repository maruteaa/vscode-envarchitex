import * as vscode from 'vscode';
import * as path from 'node:path';
import { Parser, Language, Query } from 'web-tree-sitter';
import { queryFor, type GrammarTag } from './queries.js';

export interface GrammarBundle {
  parser: Parser;
  language: Language;
  query: Query;
}

const LANGUAGE_ID_TO_TAG: Record<string, GrammarTag> = {
  javascript: 'javascript',
  javascriptreact: 'tsx',
  typescript: 'typescript',
  typescriptreact: 'tsx',
  python: 'python',
  rust: 'rust',
  php: 'php',
  go: 'go',
  ruby: 'ruby',
  java: 'java',
  csharp: 'c-sharp',
  c: 'cpp',
  cpp: 'cpp'
};

export class ParserManager implements vscode.Disposable {
  private initPromise: Promise<void> | null = null;
  private readonly bundles = new Map<GrammarTag, GrammarBundle>();
  private readonly failed = new Set<GrammarTag>();
  private readonly toastShown = new Set<GrammarTag>();
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  tagFor(languageId: string): GrammarTag | null {
    return LANGUAGE_ID_TO_TAG[languageId] ?? null;
  }

  async getBundle(languageId: string): Promise<GrammarBundle | null> {
    if (this.disposed) {
      return null;
    }
    const tag = this.tagFor(languageId);
    if (!tag) {
      return null;
    }
    if (this.failed.has(tag)) {
      return null;
    }
    const cached = this.bundles.get(tag);
    if (cached) {
      return cached;
    }
    try {
      await this.ensureInit();
      const bundle = await this.loadBundle(tag);
      this.bundles.set(tag, bundle);
      this.output.appendLine(`[parser] loaded grammar '${tag}'`);
      return bundle;
    } catch (err) {
      this.failed.add(tag);
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[parser] FAILED to load grammar '${tag}': ${msg}`);
      if (!this.toastShown.has(tag)) {
        this.toastShown.add(tag);
        void vscode.window.showWarningMessage(
          `EnvArchitex: failed to load '${tag}' grammar; ${tag} files will not be scanned.`
        );
      }
      return null;
    }
  }

  private async ensureInit(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = Parser.init().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async loadBundle(tag: GrammarTag): Promise<GrammarBundle> {
    const wasmFsPath = path.join(
      this.context.extensionUri.fsPath,
      'dist',
      'resources',
      `tree-sitter-${tag}.wasm`
    );
    const language = await Language.load(wasmFsPath);
    const parser = new Parser();
    parser.setLanguage(language);
    const querySrc = queryFor(tag);
    let query: Query;
    try {
      query = new Query(language, querySrc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`[parser] query compile failed for '${tag}': ${msg}`);
      this.output.appendLine(`[parser] query source:\n${querySrc}`);
      throw err;
    }
    return { parser, language, query };
  }

  dispose(): void {
    this.disposed = true;
    for (const bundle of this.bundles.values()) {
      try {
        bundle.query.delete();
        bundle.parser.delete();
      } catch {
        /* best-effort */
      }
    }
    this.bundles.clear();
  }
}
