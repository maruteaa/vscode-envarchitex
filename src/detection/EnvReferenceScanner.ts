import * as vscode from 'vscode';
import type { Node } from 'web-tree-sitter';
import { ParserManager } from '../parsing/ParserManager.js';
import { TypeInferenceEngine, type EnvType } from './TypeInferenceEngine.js';
import { isValidEnvKey, stripStringQuotes } from '../parsing/queries.js';

export interface EnvReference {
  key: string;
  range: vscode.Range;
  uri: vscode.Uri;
  inferredType: EnvType;
}

export interface ScanResult {
  references: EnvReference[];
  inferred: Map<string, EnvType>;
}

export class EnvReferenceScanner {
  constructor(
    private readonly parserManager: ParserManager,
    private readonly inference: TypeInferenceEngine,
    private readonly output: vscode.OutputChannel
  ) {}

  async scanDocument(document: vscode.TextDocument, useInference: boolean): Promise<ScanResult> {
    const empty: ScanResult = { references: [], inferred: new Map() };
    const bundle = await this.parserManager.getBundle(document.languageId);
    if (!bundle) {
      return empty;
    }
    const tag = this.parserManager.tagFor(document.languageId);
    if (!tag) {
      return empty;
    }

    const text = document.getText();
    const tree = bundle.parser.parse(text);
    if (!tree) {
      return empty;
    }
    try {
      const matches = bundle.query.matches(tree.rootNode);
      const inferred = new Map<string, EnvType>();
      const provisional: { key: string; range: vscode.Range; localType: EnvType }[] = [];

      for (const match of matches) {
        let refNode: Node | null = null;
        let nameNode: Node | null = null;
        let nameStringNode: Node | null = null;
        let defaultValueNode: Node | null = null;
        for (const cap of match.captures) {
          if (cap.name === 'ref') {
            refNode = cap.node;
          } else if (cap.name === 'var_name') {
            nameNode = cap.node;
          } else if (cap.name === 'var_name_string') {
            nameStringNode = cap.node;
          } else if (cap.name === 'default_value') {
            defaultValueNode = cap.node;
          }
        }
        if (!refNode) {
          continue;
        }
        const rawKey = nameNode ? nameNode.text : nameStringNode ? stripStringQuotes(nameStringNode.text) : '';
        if (!rawKey || !isValidEnvKey(rawKey)) {
          continue;
        }
        const localType: EnvType = useInference
          ? this.inference.infer(refNode, defaultValueNode, tag)
          : 'string';
        inferred.set(rawKey, this.inference.aggregate(inferred.get(rawKey), localType));

        provisional.push({
          key: rawKey,
          range: this.rangeOf(refNode),
          localType
        });
      }

      const references: EnvReference[] = provisional.map((p) => ({
        key: p.key,
        range: p.range,
        uri: document.uri,
        inferredType: inferred.get(p.key) ?? 'string'
      }));

      this.output.appendLine(
        `[scan] ${vscode.workspace.asRelativePath(document.uri)} (${document.languageId}): ${references.length} ref(s)`
      );

      return { references, inferred };
    } finally {
      try {
        tree.delete();
      } catch {
        /* best-effort */
      }
    }
  }

  private rangeOf(node: Node): vscode.Range {
    return new vscode.Range(
      new vscode.Position(node.startPosition.row, node.startPosition.column),
      new vscode.Position(node.endPosition.row, node.endPosition.column)
    );
  }
}
