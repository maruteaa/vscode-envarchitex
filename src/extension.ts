import * as vscode from 'vscode';
import { Settings } from './config/Settings.js';
import { ParserManager } from './parsing/ParserManager.js';
import { TypeInferenceEngine } from './detection/TypeInferenceEngine.js';
import { EnvReferenceScanner } from './detection/EnvReferenceScanner.js';
import { EnvFileParser } from './env/EnvFileParser.js';
import { EnvExampleWriter } from './env/EnvExampleWriter.js';
import { EnvWorkspace } from './env/EnvWorkspace.js';
import { DiagnosticOrchestrator } from './diagnostics/DiagnosticOrchestrator.js';
import { EnvCodeActionProvider, type AddArgs } from './diagnostics/EnvCodeActionProvider.js';
import { AutoSyncCoordinator } from './sync/AutoSyncCoordinator.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('EnvArchitex');
  context.subscriptions.push(output);
  output.appendLine('[activate] starting...');

  const settings = new Settings();
  context.subscriptions.push(settings);

  const parserManager = new ParserManager(context, output);
  context.subscriptions.push(parserManager);

  const inference = new TypeInferenceEngine();
  const envFileParser = new EnvFileParser();
  const scanner = new EnvReferenceScanner(parserManager, inference, output);

  const envWorkspace = new EnvWorkspace(envFileParser, settings, output);
  await envWorkspace.initialize();
  context.subscriptions.push(envWorkspace);

  const writer = new EnvExampleWriter(envFileParser, settings, output);

  const orchestrator = new DiagnosticOrchestrator(scanner, envWorkspace, settings, output);
  context.subscriptions.push(orchestrator);

  const coordinator = new AutoSyncCoordinator(
    scanner,
    envWorkspace,
    writer,
    envFileParser,
    settings,
    output
  );
  context.subscriptions.push(coordinator);

  output.appendLine(
    `[config] syncMode=${settings.syncMode}, enabledLanguages=${settings.enabledLanguages.join(',')}`
  );
  const folders = vscode.workspace.workspaceFolders ?? [];
  output.appendLine(`[config] workspace folders: ${folders.map((f) => f.name).join(', ') || '(none)'}`);

  const primaryStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
  primaryStatus.command = 'envarchitex.syncEnvExample';
  const refreshStatus = (): void => {
    primaryStatus.text = `$(database) EnvArchitex: ${settings.syncMode}`;
    primaryStatus.tooltip = 'Click to sync env targets with detected variables.';
    primaryStatus.show();
  };
  refreshStatus();
  context.subscriptions.push(primaryStatus, settings.onDidChange(refreshStatus));

  const codeActionSelector: vscode.DocumentSelector = settings.enabledLanguages.map((l) => ({
    language: l,
    scheme: 'file'
  }));
  const codeActionProvider = new EnvCodeActionProvider(scanner, envWorkspace, settings, output);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      codeActionSelector,
      codeActionProvider,
      EnvCodeActionProvider.metadata
    )
  );

  const refresh = (doc: vscode.TextDocument): void => {
    void orchestrator.refreshDocument(doc);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      output.appendLine(`[event] onDidSave ${vscode.workspace.asRelativePath(doc.uri)}`);
      refresh(doc);
      coordinator.onDidSave(doc);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => orchestrator.clear(doc.uri))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('envarchitex.syncEnvExample', async () => {
      output.appendLine('[cmd] envarchitex.syncEnvExample invoked');
      const docs = vscode.window.visibleTextEditors
        .map((e) => e.document)
        .filter((d) => d.uri.scheme === 'file');
      if (docs.length === 0) {
        void vscode.window.showInformationMessage('EnvArchitex: no visible source files to scan.');
        return;
      }
      await coordinator.runSyncForWorkspace(docs);
      void vscode.window.showInformationMessage('EnvArchitex: sync complete.');
    }),
    vscode.commands.registerCommand('envarchitex.syncEnvFromExample', async () => {
      output.appendLine('[cmd] envarchitex.syncEnvFromExample invoked');
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        void vscode.window.showWarningMessage('EnvArchitex: no workspace folder open.');
        return;
      }
      for (const folder of folders) {
        for (const mapping of envWorkspace.getMappings()) {
          for (const target of mapping.targets) {
            await coordinator.runSyncSourceFromTarget(folder, mapping.source, target);
          }
        }
      }
      void vscode.window.showInformationMessage('EnvArchitex: source env sync complete.');
    }),
    vscode.commands.registerCommand('envarchitex.syncExampleFromEnv', async () => {
      output.appendLine('[cmd] envarchitex.syncExampleFromEnv invoked');
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (folders.length === 0) {
        void vscode.window.showWarningMessage('EnvArchitex: no workspace folder open.');
        return;
      }
      for (const folder of folders) {
        for (const mapping of envWorkspace.getMappings()) {
          await coordinator.runSyncTargetsFromSource(folder, mapping.source, mapping.targets);
        }
      }
      void vscode.window.showInformationMessage('EnvArchitex: target example sync complete.');
    }),
    vscode.commands.registerCommand('envarchitex.scanWorkspace', async () => {
      output.appendLine('[cmd] envarchitex.scanWorkspace invoked');
      for (const editor of vscode.window.visibleTextEditors) {
        await orchestrator.refreshDocument(editor.document);
      }
      void vscode.window.showInformationMessage('EnvArchitex: workspace re-scan complete.');
    }),
    vscode.commands.registerCommand('envarchitex.toggleSyncMode', async () => {
      const next = settings.syncMode === 'auto' ? 'manual' : 'auto';
      await settings.setSyncMode(next);
      output.appendLine(`[cmd] envarchitex.toggleSyncMode -> ${next}`);
      void vscode.window.showInformationMessage(`EnvArchitex: sync mode is now '${next}'.`);
    }),
    vscode.commands.registerCommand('envarchitex.openEnvExample', async () => {
      output.appendLine('[cmd] envarchitex.openEnvExample invoked');
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        void vscode.window.showWarningMessage('EnvArchitex: no workspace folder open.');
        return;
      }
      const targets = envWorkspace.getAllTargetBasenames();
      let chosen = targets[0] ?? '.env.example';
      if (targets.length > 1) {
        const pick = await vscode.window.showQuickPick(targets, {
          placeHolder: 'Select target example file to open'
        });
        if (!pick) {
          return;
        }
        chosen = pick;
      }
      const uri = envWorkspace.getFileUri(folder.uri.fsPath, chosen);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf8'));
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('envarchitex.showOutput', () => {
      output.show(true);
    }),
    vscode.commands.registerCommand('envarchitex.internal.addToExample', async (args: AddArgs) => {
      output.appendLine(`[quickfix-example] add ${args.variables.length} variable(s)`);
      try {
        const result = await writer.append(args.targetUri, args.variables);
        if (result.added.length > 0) {
          void vscode.window.showInformationMessage(
            `EnvArchitex: added ${result.added.join(', ')} to .env.example.`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`[quickfix-example] FAILED: ${msg}`);
        void vscode.window.showErrorMessage(`EnvArchitex: failed to update .env.example — ${msg}`);
      }
    }),
    vscode.commands.registerCommand('envarchitex.internal.addToEnv', async (args: AddArgs) => {
      output.appendLine(`[quickfix-env] add ${args.variables.length} variable(s)`);
      try {
        const result = await writer.append(args.targetUri, args.variables);
        if (result.added.length > 0) {
          void vscode.window.showInformationMessage(
            `EnvArchitex: added ${result.added.join(', ')} to .env (empty placeholder).`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`[quickfix-env] FAILED: ${msg}`);
        void vscode.window.showErrorMessage(`EnvArchitex: failed to update .env — ${msg}`);
      }
    })
  );

  output.appendLine('[register] event listeners and commands attached');

  for (const editor of vscode.window.visibleTextEditors) {
    refresh(editor.document);
  }

  output.appendLine('[activate] ready');
}

export function deactivate(): void {
  /* disposables on subscriptions */
}
