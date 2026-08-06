import * as vscode from 'vscode';
import { EnvWorkspace } from '../env/EnvWorkspace.js';
import { EnvReferenceScanner } from '../detection/EnvReferenceScanner.js';
import type { Settings } from '../config/Settings.js';
import type { VariableToAdd } from '../env/EnvExampleWriter.js';
import type { EnvType } from '../detection/TypeInferenceEngine.js';

const ADD_TO_EXAMPLE_CMD = 'envarchitex.internal.addToExample';
const ADD_TO_ENV_CMD = 'envarchitex.internal.addToEnv';

export interface AddArgs {
  targetUri: vscode.Uri;
  variables: VariableToAdd[];
}

export class EnvCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
  };

  constructor(
    private readonly scanner: EnvReferenceScanner,
    private readonly workspace: EnvWorkspace,
    private readonly settings: Settings,
    private readonly output: vscode.OutputChannel
  ) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    const diagnostics = context.diagnostics.filter((d) => d.source === 'EnvArchitex');
    if (diagnostics.length === 0) {
      return [];
    }
    const folder = this.workspace.folderFor(document.uri);
    if (!folder) {
      return [];
    }

    const { references } = await this.scanner.scanDocument(
      document,
      this.settings.typeInferenceEnabled
    );
    const typeByKey = new Map<string, EnvType>();
    for (const ref of references) {
      typeByKey.set(ref.key, ref.inferredType);
    }

    const actions: vscode.CodeAction[] = [];
    const missingExample: { key: string; type: EnvType; diag: vscode.Diagnostic }[] = [];
    const missingLocal: { key: string; type: EnvType; diag: vscode.Diagnostic }[] = [];

    for (const diag of diagnostics) {
      const key = this.keyFromDiagnostic(diag);
      if (!key) {
        continue;
      }
      const type = typeByKey.get(key) ?? 'string';
      if (diag.code === 'missing-from-example') {
        missingExample.push({ key, type, diag });
      } else if (diag.code === 'missing-from-local') {
        missingLocal.push({ key, type, diag });
      }
    }

    for (const mapping of this.workspace.getMappings()) {
      for (const target of mapping.targets) {
        const targetUri = this.workspace.getFileUri(folder.uri.fsPath, target);
        for (const m of missingExample) {
          const a = new vscode.CodeAction(
            `Add '${m.key}' to ${target}`,
            vscode.CodeActionKind.QuickFix
          );
          a.diagnostics = [m.diag];
          a.isPreferred = true;
          a.command = {
            command: ADD_TO_EXAMPLE_CMD,
            title: a.title,
            arguments: [
              {
                targetUri,
                variables: [{ key: m.key, type: m.type }]
              } satisfies AddArgs
            ]
          };
          actions.push(a);
        }

        if (missingExample.length > 1) {
          const batch = new vscode.CodeAction(
            `Add ${missingExample.length} missing variables to ${target}`,
            vscode.CodeActionKind.QuickFix
          );
          batch.diagnostics = missingExample.map((m) => m.diag);
          batch.command = {
            command: ADD_TO_EXAMPLE_CMD,
            title: batch.title,
            arguments: [
              {
                targetUri,
                variables: missingExample.map((m) => ({ key: m.key, type: m.type }))
              } satisfies AddArgs
            ]
          };
          actions.push(batch);
        }
      }

      const sourceUri = this.workspace.getFileUri(folder.uri.fsPath, mapping.source);
      for (const m of missingLocal) {
        const a = new vscode.CodeAction(
          `Add '${m.key}' to ${mapping.source} (empty placeholder)`,
          vscode.CodeActionKind.QuickFix
        );
        a.diagnostics = [m.diag];
        a.command = {
          command: ADD_TO_ENV_CMD,
          title: a.title,
          arguments: [
            {
              targetUri: sourceUri,
              variables: [{ key: m.key, type: m.type }]
            } satisfies AddArgs
          ]
        };
        actions.push(a);
      }
    }

    this.output.appendLine(`[quickfix] offered ${actions.length} action(s)`);
    return actions;
  }

  private keyFromDiagnostic(diag: vscode.Diagnostic): string | null {
    const m = /'([^']+)'/.exec(diag.message);
    return m ? m[1] : null;
  }
}
