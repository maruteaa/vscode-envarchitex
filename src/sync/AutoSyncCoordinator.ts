import * as vscode from 'vscode';
import * as path from 'node:path';
import { EnvReferenceScanner } from '../detection/EnvReferenceScanner.js';
import { EnvWorkspace } from '../env/EnvWorkspace.js';
import { EnvExampleWriter, type VariableToAdd } from '../env/EnvExampleWriter.js';
import { EnvFileParser } from '../env/EnvFileParser.js';
import type { Settings } from '../config/Settings.js';
import type { EnvType } from '../detection/TypeInferenceEngine.js';

const TYPE_COMMENT_RE = /^#\s*type:\s*(string|number|boolean)\b/;

const DEBOUNCE_MS = 300;

interface PendingHint {
  uri: vscode.Uri;
  keys: string[];
}

export class AutoSyncCoordinator implements vscode.Disposable {
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly mutexes = new Map<string, Promise<void>>();
  private readonly pendingHints = new Map<string, PendingHint>();
  private readonly statusBar: vscode.StatusBarItem;

  constructor(
    private readonly scanner: EnvReferenceScanner,
    private readonly workspace: EnvWorkspace,
    private readonly writer: EnvExampleWriter,
    private readonly envFileParser: EnvFileParser,
    private readonly settings: Settings,
    private readonly output: vscode.OutputChannel
  ) {
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBar.command = 'envarchitex.openEnvExample';
    this.updateStatusBar();
  }

  onDidSave(document: vscode.TextDocument): void {
    const base = path.basename(document.uri.fsPath);
    const folder = this.workspace.folderFor(document.uri);
    if (!folder) {
      return;
    }

    const sourcesForThisTarget = this.workspace.getSourcesForTarget(base);
    if (sourcesForThisTarget.length > 0) {
      this.onDidSaveTarget(document, folder, base, sourcesForThisTarget);
      return;
    }

    const targetsForThisSource = this.workspace.getTargetsForSource(base);
    if (targetsForThisSource.length > 0) {
      this.onDidSaveSource(document, folder, base, targetsForThisSource);
      return;
    }

    if (this.settings.syncMode !== 'auto') {
      this.output.appendLine(
        `[sync] skip ${vscode.workspace.asRelativePath(document.uri)}: syncMode='manual'`
      );
      return;
    }
    if (!this.settings.enabledLanguages.includes(document.languageId)) {
      this.output.appendLine(
        `[sync] skip ${vscode.workspace.asRelativePath(document.uri)}: language '${document.languageId}' disabled`
      );
      return;
    }

    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const t = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.runSyncForDocument(document);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(key, t);
  }

  private onDidSaveTarget(
    document: vscode.TextDocument,
    folder: vscode.WorkspaceFolder,
    targetBasename: string,
    sources: string[]
  ): void {
    if (this.settings.syncEnvFromExampleMode !== 'auto') {
      this.output.appendLine(
        `[sync-env] skip ${vscode.workspace.asRelativePath(document.uri)}: syncEnvFromExample='manual'`
      );
      return;
    }
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const t = setTimeout(() => {
      this.debounceTimers.delete(key);
      for (const source of sources) {
        void this.runSyncSourceFromTarget(folder, source, targetBasename);
      }
    }, DEBOUNCE_MS);
    this.debounceTimers.set(key, t);
  }

  private onDidSaveSource(
    document: vscode.TextDocument,
    folder: vscode.WorkspaceFolder,
    sourceBasename: string,
    targets: string[]
  ): void {
    if (this.settings.syncExampleFromEnvMode !== 'auto') {
      this.output.appendLine(
        `[sync-example] skip ${vscode.workspace.asRelativePath(document.uri)}: syncExampleFromEnv='manual'`
      );
      return;
    }
    const key = document.uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const t = setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.runSyncTargetsFromSource(folder, sourceBasename, targets);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(key, t);
  }

  async runSyncForDocument(document: vscode.TextDocument): Promise<void> {
    const folder = this.workspace.folderFor(document.uri);
    if (!folder) {
      return;
    }

    const { references } = await this.scanner.scanDocument(
      document,
      this.settings.typeInferenceEnabled
    );
    this.output.appendLine(
      `[sync] ${vscode.workspace.asRelativePath(document.uri)}: ${references.length} ref(s)`
    );

    for (const mapping of this.workspace.getMappings()) {
      for (const target of mapping.targets) {
        const missing: VariableToAdd[] = [];
        const seen = new Set<string>();
        for (const ref of references) {
          if (seen.has(ref.key)) {
            continue;
          }
          seen.add(ref.key);
          if (!this.workspace.hasKeyInFile(folder.uri.fsPath, target, ref.key)) {
            missing.push({ key: ref.key, type: ref.inferredType });
          }
        }
        if (missing.length === 0) {
          this.clearPendingHint(folder.uri.fsPath);
          continue;
        }

        const targetUri = this.workspace.getFileUri(folder.uri.fsPath, target);
        if (this.isDocDirty(targetUri)) {
          this.output.appendLine(
            `[sync] defer: ${target} for '${folder.name}' is open with unsaved changes`
          );
          this.setPendingHint(folder.uri.fsPath, targetUri, missing.map((m) => m.key));
          continue;
        }

        await this.withMutex(targetUri, async () => {
          const result = await this.writer.append(targetUri, missing);
          if (result.added.length > 0) {
            this.notify(document.uri, target, result.added);
          }
        });
        this.clearPendingHint(folder.uri.fsPath);

        if (this.settings.syncEnvFromExampleMode === 'auto') {
          await this.runSyncSourceFromTarget(folder, mapping.source, target);
        }
      }
    }
  }

  async runSyncForWorkspace(documents: vscode.TextDocument[]): Promise<void> {
    for (const doc of documents) {
      await this.runSyncForDocument(doc);
    }
  }

  async runSyncSourceFromTarget(
    folder: vscode.WorkspaceFolder,
    sourceBasename: string,
    targetBasename: string
  ): Promise<void> {
    const targetUri = this.workspace.getFileUri(folder.uri.fsPath, targetBasename);
    let text: string;
    try {
      const buf = await vscode.workspace.fs.readFile(targetUri);
      text = Buffer.from(buf).toString('utf8');
    } catch {
      this.output.appendLine(`[sync-env] no ${targetBasename} in '${folder.name}'`);
      return;
    }

    const parsed = this.envFileParser.parse(text);
    const vars: VariableToAdd[] = [];
    const seen = new Set<string>();
    for (const line of parsed.lines) {
      if (line.kind !== 'kv' || seen.has(line.key)) {
        continue;
      }
      seen.add(line.key);
      if (this.workspace.hasKeyInFile(folder.uri.fsPath, sourceBasename, line.key)) {
        continue;
      }
      vars.push({ key: line.key, type: this.parseTypeFromInline(line.inlineComment) });
    }
    this.output.appendLine(
      `[sync-env] '${folder.name}': ${vars.length} key(s) missing from ${sourceBasename}`
    );
    if (vars.length === 0) {
      return;
    }

    const sourceUri = this.workspace.getFileUri(folder.uri.fsPath, sourceBasename);
    if (this.isDocDirty(sourceUri)) {
      this.output.appendLine(
        `[sync-env] defer: ${sourceBasename} for '${folder.name}' is open with unsaved changes`
      );
      return;
    }
    await this.withMutex(sourceUri, async () => {
      const result = await this.writer.append(sourceUri, vars);
      if (result.added.length > 0) {
        this.notify(targetUri, sourceBasename, result.added);
      }
    });
  }

  async runSyncTargetsFromSource(
    folder: vscode.WorkspaceFolder,
    sourceBasename: string,
    targetBasenames: string[]
  ): Promise<void> {
    const sourceUri = this.workspace.getFileUri(folder.uri.fsPath, sourceBasename);
    let text: string;
    try {
      const buf = await vscode.workspace.fs.readFile(sourceUri);
      text = Buffer.from(buf).toString('utf8');
    } catch {
      this.output.appendLine(`[sync-example] no ${sourceBasename} in '${folder.name}'`);
      return;
    }

    const parsed = this.envFileParser.parse(text);
    for (const targetBasename of targetBasenames) {
      const vars: VariableToAdd[] = [];
      const seen = new Set<string>();
      for (const line of parsed.lines) {
        if (line.kind !== 'kv' || seen.has(line.key)) {
          continue;
        }
        seen.add(line.key);
        if (this.workspace.hasKeyInFile(folder.uri.fsPath, targetBasename, line.key)) {
          continue;
        }
        vars.push({ key: line.key, type: this.inferTypeFromEnvValue(line) });
      }
      this.output.appendLine(
        `[sync-example] '${folder.name}': ${vars.length} key(s) missing from ${targetBasename}`
      );
      if (vars.length === 0) {
        continue;
      }

      const targetUri = this.workspace.getFileUri(folder.uri.fsPath, targetBasename);
      if (this.isDocDirty(targetUri)) {
        this.output.appendLine(
          `[sync-example] defer: ${targetBasename} for '${folder.name}' is open with unsaved changes`
        );
        this.setPendingHint(folder.uri.fsPath, targetUri, vars.map((v) => v.key));
        continue;
      }
      await this.withMutex(targetUri, async () => {
        const result = await this.writer.append(targetUri, vars);
        if (result.added.length > 0) {
          this.notify(sourceUri, targetBasename, result.added);
        }
      });
      this.clearPendingHint(folder.uri.fsPath);
    }
  }

  private parseTypeFromInline(comment: string | null): EnvType {
    if (!comment) {
      return 'string';
    }
    const m = TYPE_COMMENT_RE.exec(comment);
    return m ? (m[1] as EnvType) : 'string';
  }

  private inferTypeFromEnvValue(line: {
    inlineComment: string | null;
    quote: '"' | "'" | null;
    rawValue: string;
  }): EnvType {
    if (line.inlineComment) {
      const m = TYPE_COMMENT_RE.exec(line.inlineComment);
      if (m) {
        return m[1] as EnvType;
      }
    }
    if (line.quote !== null) {
      return 'string';
    }
    const raw = line.rawValue.trim();
    if (raw === '') {
      return 'string';
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      return 'number';
    }
    if (/^(true|false|True|False)$/.test(raw)) {
      return 'boolean';
    }
    return 'string';
  }

  private notify(sourceUri: vscode.Uri, target: string, added: string[]): void {
    const mode = this.settings.notifyOnSync;
    if (mode === 'off') {
      return;
    }
    const display = added.slice(0, 5).map((k) => `'${k}'`).join(', ');
    const extra = added.length > 5 ? ` (+${added.length - 5} more)` : '';
    const source = vscode.workspace.asRelativePath(sourceUri);
    const message = `EnvArchitex: Added ${added.length} variable(s) to ${target} from ${source}: ${display}${extra}`;
    void vscode.window.showInformationMessage(message);
  }

  private isDocDirty(uri: vscode.Uri): boolean {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.toString() === uri.toString() && doc.isDirty) {
        return true;
      }
    }
    return false;
  }

  private setPendingHint(folderFs: string, uri: vscode.Uri, keys: string[]): void {
    this.pendingHints.set(folderFs, { uri, keys });
    this.updateStatusBar();
  }

  private clearPendingHint(folderFs: string): void {
    if (this.pendingHints.delete(folderFs)) {
      this.updateStatusBar();
    }
  }

  private updateStatusBar(): void {
    if (this.pendingHints.size === 0) {
      this.statusBar.hide();
      return;
    }
    const totalKeys = [...this.pendingHints.values()].reduce((n, p) => n + p.keys.length, 0);
    const sample = [...this.pendingHints.values()][0].keys.slice(0, 3).join(', ');
    this.statusBar.text = `$(warning) EnvArchitex: ${totalKeys} pending (${sample}…) — save target file`;
    this.statusBar.tooltip = 'EnvArchitex has new variables to sync, but target file has unsaved changes.';
    this.statusBar.show();
  }

  private async withMutex(uri: vscode.Uri, fn: () => Promise<void>): Promise<void> {
    const key = uri.toString();
    const prev = this.mutexes.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mutexes.set(key, prev.then(() => next));
    try {
      await prev;
      await fn();
    } finally {
      release();
      if (this.mutexes.get(key) && (await this.isHead(key))) {
        this.mutexes.delete(key);
      }
    }
  }

  private async isHead(_key: string): Promise<boolean> {
    return true;
  }

  dispose(): void {
    for (const t of this.debounceTimers.values()) {
      clearTimeout(t);
    }
    this.debounceTimers.clear();
    this.statusBar.dispose();
  }
}
