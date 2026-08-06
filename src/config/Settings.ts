import * as vscode from 'vscode';

export type SyncMode = 'auto' | 'manual';
export type ExampleSeverity = 'warning' | 'off';
export type LocalSeverity = 'info' | 'off';
export type NotifyMode = 'always' | 'summary' | 'off';

export interface SyncMapping {
  source: string;
  targets: string[];
}

export class Settings implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly subscription: vscode.Disposable;

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.subscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('envarchitex')) {
        this.emitter.fire();
      }
    });
  }

  private get cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('envarchitex');
  }

  get syncMode(): SyncMode {
    return this.cfg.get<SyncMode>('syncMode', 'auto');
  }

  get syncEnvFromExampleMode(): SyncMode {
    return this.cfg.get<SyncMode>('syncEnvFromExample.mode', 'auto');
  }

  get syncExampleFromEnvMode(): SyncMode {
    return this.cfg.get<SyncMode>('syncExampleFromEnv.mode', 'auto');
  }

  get envExampleSeverity(): ExampleSeverity {
    return this.cfg.get<ExampleSeverity>('diagnostics.envExample', 'warning');
  }

  get envLocalSeverity(): LocalSeverity {
    return this.cfg.get<LocalSeverity>('diagnostics.envLocal', 'info');
  }

  get syncMappings(): SyncMapping[] {
    const raw = this.cfg.get<SyncMapping[]>('syncMappings', [
      { source: '.env', targets: ['.env.example'] }
    ]);
    if (!Array.isArray(raw)) {
      return [{ source: '.env', targets: ['.env.example'] }];
    }
    const filtered = raw.filter(
      (m) =>
        m &&
        typeof m.source === 'string' &&
        m.source.trim().length > 0 &&
        Array.isArray(m.targets) &&
        m.targets.length > 0 &&
        m.targets.every((t) => typeof t === 'string' && t.trim().length > 0)
    );
    return filtered.length > 0 ? filtered : [{ source: '.env', targets: ['.env.example'] }];
  }

  get enabledLanguages(): string[] {
    return this.cfg.get<string[]>(
      'languages.enabled',
      [
        'javascript',
        'javascriptreact',
        'typescript',
        'typescriptreact',
        'python',
        'rust',
        'php',
        'go',
        'ruby',
        'java',
        'csharp',
        'c',
        'cpp'
      ]
    );
  }

  get typeInferenceEnabled(): boolean {
    return this.cfg.get<boolean>('typeInference.enabled', true);
  }

  get emitTypeComment(): boolean {
    return this.cfg.get<boolean>('typeInference.emitTypeComment', true);
  }

  get notifyOnSync(): NotifyMode {
    return this.cfg.get<NotifyMode>('notifications.onSync', 'always');
  }

  get ignoreGlobs(): string[] {
    return this.cfg.get<string[]>(
      'ignore.globs',
      [
        '**/node_modules/**',
        '**/.venv/**',
        '**/dist/**',
        '**/build/**',
        '**/out/**',
        '**/target/**',
        '**/vendor/**',
        '**/.gradle/**',
        '**/bin/**',
        '**/obj/**'
      ]
    );
  }

  get maxFileBytes(): number {
    return this.cfg.get<number>('maxFileBytes', 1_048_576);
  }

  async setSyncMode(mode: SyncMode): Promise<void> {
    await this.cfg.update('syncMode', mode, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}
