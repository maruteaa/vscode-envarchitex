import * as vscode from 'vscode';
import * as path from 'node:path';
import { EnvFileParser } from './EnvFileParser.js';
import type { Settings, SyncMapping } from '../config/Settings.js';

interface FolderEntry {
  keysByFile: Map<string, Set<string>>;
}

export class EnvWorkspace implements vscode.Disposable {
  private readonly entries = new Map<string, FolderEntry>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private watcher: vscode.FileSystemWatcher | null = null;
  private folderSub: vscode.Disposable | null = null;
  private settingsSub: vscode.Disposable | null = null;

  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly parser: EnvFileParser,
    private readonly settings: Settings,
    private readonly output: vscode.OutputChannel
  ) {}

  async initialize(): Promise<void> {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/.env*');
    this.watcher.onDidCreate((uri) => this.onWatched(uri));
    this.watcher.onDidChange((uri) => this.onWatched(uri));
    this.watcher.onDidDelete((uri) => this.onWatched(uri));

    this.folderSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void this.refreshAll();
    });

    this.settingsSub = this.settings.onDidChange(() => {
      void this.refreshAll();
    });

    await this.refreshAll();
  }

  get trackedBasenames(): Set<string> {
    const names = new Set<string>();
    for (const m of this.settings.syncMappings) {
      names.add(m.source);
      for (const t of m.targets) {
        names.add(t);
      }
    }
    return names;
  }

  hasKeyInFile(folderFsPath: string, basename: string, key: string): boolean {
    return this.entries.get(folderFsPath)?.keysByFile.get(basename)?.has(key) ?? false;
  }

  hasKeyInAny(folderFsPath: string, basenames: string[], key: string): boolean {
    const entry = this.entries.get(folderFsPath);
    if (!entry) {
      return false;
    }
    return basenames.some((b) => entry.keysByFile.get(b)?.has(key) ?? false);
  }

  getFileUri(folderFsPath: string, basename: string): vscode.Uri {
    return vscode.Uri.file(path.join(folderFsPath, basename));
  }

  getTargetsForSource(sourceBasename: string): string[] {
    const targets: string[] = [];
    for (const m of this.settings.syncMappings) {
      if (m.source === sourceBasename) {
        targets.push(...m.targets);
      }
    }
    return [...new Set(targets)];
  }

  getSourcesForTarget(targetBasename: string): string[] {
    const sources: string[] = [];
    for (const m of this.settings.syncMappings) {
      if (m.targets.includes(targetBasename)) {
        sources.push(m.source);
      }
    }
    return [...new Set(sources)];
  }

  getAllSourceBasenames(): string[] {
    return [...new Set(this.settings.syncMappings.map((m) => m.source))];
  }

  getAllTargetBasenames(): string[] {
    return [...new Set(this.settings.syncMappings.flatMap((m) => m.targets))];
  }

  getMappings(): SyncMapping[] {
    return this.settings.syncMappings;
  }

  folderFor(documentUri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(documentUri);
  }

  private isTracked(uri: vscode.Uri): boolean {
    const base = path.basename(uri.fsPath);
    return this.trackedBasenames.has(base);
  }

  private async onWatched(uri: vscode.Uri): Promise<void> {
    if (!this.isTracked(uri)) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      return;
    }
    await this.refreshFolder(folder);
    this.emitter.fire();
  }

  private async refreshAll(): Promise<void> {
    this.entries.clear();
    const folders = vscode.workspace.workspaceFolders ?? [];
    await Promise.all(folders.map((f) => this.refreshFolder(f)));
    this.emitter.fire();
  }

  private async refreshFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    const fsPath = folder.uri.fsPath;
    const keysByFile = new Map<string, Set<string>>();
    for (const basename of this.trackedBasenames) {
      const keys = await this.readKeys(path.join(fsPath, basename));
      keysByFile.set(basename, keys);
    }
    this.entries.set(fsPath, { keysByFile });
    this.output.appendLine(
      `[env] folder '${folder.name}': tracking ${keysByFile.size} file(s): ${[...keysByFile.entries()].map(([b, k]) => `${b}=${k.size}`).join(', ')}`
    );
  }

  private async readKeys(fsPath: string): Promise<Set<string>> {
    try {
      const buf = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
      const text = Buffer.from(buf).toString('utf8');
      return this.parser.keysOf(this.parser.parse(text));
    } catch {
      return new Set<string>();
    }
  }

  dispose(): void {
    this.watcher?.dispose();
    this.folderSub?.dispose();
    this.settingsSub?.dispose();
    this.emitter.dispose();
  }
}
