import type { Node } from 'web-tree-sitter';
import type { GrammarTag } from '../parsing/queries.js';

export type EnvType = 'string' | 'number' | 'boolean';

const NUMBER_FN_JS = new Set(['parseInt', 'parseFloat', 'Number']);
const BOOLEAN_FN_JS = new Set(['Boolean']);
const BOOLEAN_LITERAL_JS = new Set([
  'true', 'false', 'True', 'False', 'TRUE', 'FALSE',
  '"true"', '"false"', '"True"', '"False"', '"TRUE"', '"FALSE"',
  "'true'", "'false'", "'True'", "'False'", "'TRUE'", "'FALSE'"
]);

const NUMBER_FN_PY = new Set(['int', 'float']);
const BOOLEAN_FN_PY = new Set(['bool']);
const BOOLEAN_LITERAL_PY = new Set([
  "'true'", '"true"', "'false'", '"false"',
  "'True'", '"True"', "'False'", '"False"',
  "'TRUE'", '"TRUE"', "'FALSE'", '"FALSE"',
  'True', 'False', 'TRUE', 'FALSE', 'true', 'false'
]);

const MAX_PARENT_DEPTH = 4;

const NUMBER_FN_PHP = new Set(['intval', 'floatval']);
const BOOLEAN_FN_PHP = new Set(['boolval']);

const NUMBER_FN_GO = new Set(['Atoi', 'ParseInt', 'ParseFloat']);
const BOOLEAN_FN_GO = new Set(['ParseBool']);

const NUMBER_FN_JAVA = new Set(['parseInt', 'parseDouble', 'parseFloat', 'parseLong', 'valueOf']);
const BOOLEAN_FN_JAVA = new Set(['parseBoolean', 'valueOf', 'equalsIgnoreCase', 'equals']);

const NUMBER_FN_CSHARP = new Set(['Parse', 'ToInt32', 'ToDouble', 'ToSingle', 'ToInt64']);
const BOOLEAN_FN_CSHARP = new Set(['Parse', 'ToBoolean']);

const NUMBER_FN_CPP = new Set(['atoi', 'atof', 'atol', 'strtol', 'strtod', 'strtof', 'stoi', 'stod', 'stof']);

export class TypeInferenceEngine {
  infer(refNode: Node, defaultValueNode: Node | null, tag: GrammarTag): EnvType {
    switch (tag) {
      case 'python': {
        const fromDefault = this.inferFromDefaultValue(defaultValueNode);
        if (fromDefault) {
          return fromDefault;
        }
        return this.inferPython(refNode);
      }
      case 'ruby': {
        const fromDefault = this.inferFromDefaultValue(defaultValueNode);
        if (fromDefault) {
          return fromDefault;
        }
        return this.inferRuby(refNode);
      }
      case 'php': {
        const fromDefault = this.inferFromDefaultValue(defaultValueNode);
        if (fromDefault) {
          return fromDefault;
        }
        return this.inferGeneric(refNode, NUMBER_FN_PHP, BOOLEAN_FN_PHP);
      }
      case 'rust':
        return this.inferGeneric(refNode, new Set(['parse']), new Set());
      case 'go':
        return this.inferGeneric(refNode, NUMBER_FN_GO, BOOLEAN_FN_GO);
      case 'java':
        return this.inferGeneric(refNode, NUMBER_FN_JAVA, BOOLEAN_FN_JAVA);
      case 'c-sharp':
        return this.inferGeneric(refNode, NUMBER_FN_CSHARP, BOOLEAN_FN_CSHARP);
      case 'cpp':
        return this.inferGeneric(refNode, NUMBER_FN_CPP, new Set());
      default:
        return this.inferJsTs(refNode);
    }
  }

  private inferGeneric(refNode: Node, numFns: Set<string>, boolFns: Set<string>): EnvType {
    let node: Node | null = refNode.parent;
    for (let depth = 0; depth < MAX_PARENT_DEPTH && node; depth++, node = node.parent) {
      const t = node.type;
      // Check for direct function call wrapping
      if (t === 'call_expression' || t === 'method_invocation' || t === 'invocation_expression') {
        const fnNode = node.childForFieldName('function') || node.childForFieldName('name');
        if (fnNode) {
          const fnName = this.extractFunctionName(fnNode);
          if (fnName && numFns.has(fnName)) {
            return 'number';
          }
          if (fnName && boolFns.has(fnName)) {
            return 'boolean';
          }
        }
      }
      // Check for comparison with boolean-like values
      if (t === 'binary_expression') {
        const op = this.binaryOp(node);
        if (op === '==' || op === '!=' || op === '===' || op === '!==') {
          return 'boolean';
        }
      }
      // Check for type cast expressions (e.g., PHP `(int)`, Go type conversion)
      if (t === 'cast_expression') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          const typeName = typeNode.text.toLowerCase();
          if (typeName.includes('int') || typeName.includes('float') || typeName.includes('double') || typeName.includes('long')) {
            return 'number';
          }
          if (typeName.includes('bool') || typeName.includes('boolean')) {
            return 'boolean';
          }
        }
      }
    }
    return 'string';
  }

  private extractFunctionName(fnNode: Node): string | null {
    if (fnNode.type === 'identifier') {
      return fnNode.text;
    }
    if (fnNode.type === 'selector_expression' || fnNode.type === 'member_expression' || fnNode.type === 'member_access_expression') {
      const field = fnNode.childForFieldName('field') || fnNode.childForFieldName('property') || fnNode.childForFieldName('name');
      return field ? field.text : null;
    }
    if (fnNode.type === 'scoped_identifier' || fnNode.type === 'qualified_identifier') {
      const name = fnNode.childForFieldName('name');
      return name ? name.text : null;
    }
    return fnNode.text;
  }

  private inferRuby(refNode: Node): EnvType {
    let node: Node | null = refNode.parent;
    for (let depth = 0; depth < MAX_PARENT_DEPTH && node; depth++, node = node.parent) {
      const t = node.type;
      if (t === 'call') {
        const methodNode = node.childForFieldName('method');
        if (methodNode && (methodNode.text === 'to_i' || methodNode.text === 'to_f')) {
          return 'number';
        }
      }
      if (t === 'binary') {
        const op = this.binaryOp(node);
        if (op === '==' || op === '!=') {
          return 'boolean';
        }
      }
    }
    return 'string';
  }

  aggregate(existing: EnvType | undefined, next: EnvType): EnvType {
    if (existing === undefined) {
      return next;
    }
    return this.precedence(existing, next);
  }

  placeholderFor(type: EnvType): string {
    switch (type) {
      case 'number':
        return '0';
      case 'boolean':
        return 'false';
      default:
        return '""';
    }
  }

  private precedence(a: EnvType, b: EnvType): EnvType {
    const rank = (t: EnvType): number => (t === 'boolean' ? 2 : t === 'number' ? 1 : 0);
    return rank(a) >= rank(b) ? a : b;
  }

  private inferJsTs(refNode: Node): EnvType {
    let node: Node | null = refNode.parent;
    for (let depth = 0; depth < MAX_PARENT_DEPTH && node; depth++, node = node.parent) {
      const t = node.type;
      if (t === 'call_expression') {
        const callee = node.childForFieldName('function');
        const name = callee ? callee.text : '';
        if (NUMBER_FN_JS.has(name)) {
          return 'number';
        }
        if (BOOLEAN_FN_JS.has(name)) {
          return 'boolean';
        }
        continue;
      }
      if (t === 'unary_expression') {
        const op = this.unaryOp(node);
        if (op === '+') {
          return 'number';
        }
        if (op === '!') {
          return 'boolean';
        }
        continue;
      }
      if (t === 'binary_expression') {
        const op = this.binaryOp(node);
        if (op === '===' || op === '!==' || op === '==' || op === '!=') {
          const left = node.childForFieldName('left');
          const right = node.childForFieldName('right');
          const other = this.otherOperand(refNode, left, right);
          if (other && BOOLEAN_LITERAL_JS.has(other.text)) {
            return 'boolean';
          }
        }
        continue;
      }
      if (t === 'ternary_expression') {
        const consequence = node.childForFieldName('consequence');
        const alternative = node.childForFieldName('alternative');
        const sameType = this.bothLiteralsSameType(consequence, alternative);
        if (sameType) {
          return sameType;
        }
        continue;
      }
    }
    return 'string';
  }

  private inferPython(refNode: Node): EnvType {
    let node: Node | null = refNode.parent;
    for (let depth = 0; depth < MAX_PARENT_DEPTH && node; depth++, node = node.parent) {
      const t = node.type;
      if (t === 'call') {
        const fn = node.childForFieldName('function');
        const name = fn ? fn.text : '';
        if (NUMBER_FN_PY.has(name)) {
          return 'number';
        }
        if (BOOLEAN_FN_PY.has(name)) {
          return 'boolean';
        }
        continue;
      }
      if (t === 'comparison_operator') {
        const literal = this.pythonComparisonLiteral(node, refNode);
        if (literal && BOOLEAN_LITERAL_PY.has(literal)) {
          return 'boolean';
        }
        continue;
      }
      if (t === 'unary_operator') {
        const op = this.unaryOp(node);
        if (op === '+' || op === '-') {
          return 'number';
        }
        continue;
      }
    }
    return 'string';
  }

  private inferFromDefaultValue(node: Node | null): EnvType | null {
    if (!node) {
      return null;
    }
    const t = node.type;
    if (t === 'integer' || t === 'float' || t === 'number') {
      return 'number';
    }
    if (t === 'true' || t === 'false' || t === 'True' || t === 'False' || t === 'TRUE' || t === 'FALSE' || t === 'boolean') {
      return 'boolean';
    }
    if (t === 'string' || t === 'string_literal' || t === 'interpreted_string_literal' || t === 'simple_symbol') {
      const text = node.text;
      if (BOOLEAN_LITERAL_JS.has(text) || BOOLEAN_LITERAL_PY.has(text)) {
        return 'boolean';
      }
      return 'string';
    }
    return null;
  }

  private unaryOp(node: Node): string | null {
    for (const child of node.children) {
      if (child && !child.isNamed) {
        return child.type;
      }
    }
    return null;
  }

  private binaryOp(node: Node): string | null {
    const opNode = node.childForFieldName('operator');
    if (opNode) {
      return opNode.type;
    }
    for (const child of node.children) {
      if (child && !child.isNamed) {
        return child.type;
      }
    }
    return null;
  }

  private otherOperand(ref: Node, left: Node | null, right: Node | null): Node | null {
    if (!left || !right) {
      return null;
    }
    if (this.contains(left, ref)) {
      return right;
    }
    if (this.contains(right, ref)) {
      return left;
    }
    return null;
  }

  private contains(outer: Node, inner: Node): boolean {
    return inner.startIndex >= outer.startIndex && inner.endIndex <= outer.endIndex;
  }

  private bothLiteralsSameType(a: Node | null, b: Node | null): EnvType | null {
    if (!a || !b) {
      return null;
    }
    const ta = this.literalType(a);
    const tb = this.literalType(b);
    if (ta && tb && ta === tb) {
      return ta;
    }
    return null;
  }

  private literalType(node: Node): EnvType | null {
    const t = node.type;
    if (t === 'number') {
      return 'number';
    }
    if (t === 'string' || t === 'template_string') {
      return 'string';
    }
    if (t === 'true' || t === 'false') {
      return 'boolean';
    }
    return null;
  }

  private pythonComparisonLiteral(cmp: Node, ref: Node): string | null {
    for (const child of cmp.namedChildren) {
      if (!child) {
        continue;
      }
      if (this.contains(child, ref)) {
        continue;
      }
      const t = child.type;
      if (t === 'string' || t === 'true' || t === 'false' || t === 'True' || t === 'False') {
        return child.text;
      }
    }
    return null;
  }
}
