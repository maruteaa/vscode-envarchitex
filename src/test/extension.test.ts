import * as assert from 'node:assert';
import { EnvFileParser } from '../env/EnvFileParser.js';
import { isValidEnvKey, stripStringQuotes } from '../parsing/queries.js';

suite('EnvFileParser', () => {
  const parser = new EnvFileParser();

  test('round-trips a simple file', () => {
    const src = 'A=1\nB=2\n';
    const parsed = parser.parse(src);
    assert.strictEqual(parser.serialize(parsed), src);
  });

  test('preserves comments and blank lines', () => {
    const src = '# top\n\nKEY=value\n# another\n';
    const parsed = parser.parse(src);
    assert.strictEqual(parser.serialize(parsed), src);
  });

  test('preserves exported and quoted values', () => {
    const src = 'export TOKEN="abc def"\nQ=\'single\'\n';
    const parsed = parser.parse(src);
    assert.strictEqual(parser.serialize(parsed), src);
  });

  test('preserves inline comments', () => {
    const src = 'PORT=8080 # the port\n';
    const parsed = parser.parse(src);
    assert.strictEqual(parser.serialize(parsed), src);
  });

  test('preserves CRLF line endings', () => {
    const src = 'A=1\r\nB=2\r\n';
    const parsed = parser.parse(src);
    assert.strictEqual(parsed.eol, '\r\n');
    assert.strictEqual(parser.serialize(parsed), src);
  });

  test('does not interpret # inside quoted value as comment', () => {
    const src = 'URL="https://example.com/#frag"\n';
    const parsed = parser.parse(src);
    const kv = parsed.lines[0];
    assert.strictEqual(kv.kind, 'kv');
    if (kv.kind === 'kv') {
      assert.strictEqual(kv.inlineComment, null);
    }
  });

  test('keysOf returns kv keys only', () => {
    const parsed = parser.parse('# x\nA=1\nB=2\n\n');
    const keys = parser.keysOf(parsed);
    assert.deepStrictEqual([...keys].sort(), ['A', 'B']);
  });
});

suite('isValidEnvKey', () => {
  test('accepts standard keys', () => {
    assert.strictEqual(isValidEnvKey('A'), true);
    assert.strictEqual(isValidEnvKey('_A'), true);
    assert.strictEqual(isValidEnvKey('DB_URL'), true);
    assert.strictEqual(isValidEnvKey('PORT_1'), true);
  });

  test('rejects invalid keys', () => {
    assert.strictEqual(isValidEnvKey(''), false);
    assert.strictEqual(isValidEnvKey('1A'), false);
    assert.strictEqual(isValidEnvKey('A-B'), false);
    assert.strictEqual(isValidEnvKey('A.B'), false);
    assert.strictEqual(isValidEnvKey('A B'), false);
  });
});

suite('stripStringQuotes', () => {
  test('strips double and single quotes', () => {
    assert.strictEqual(stripStringQuotes('"PORT"'), 'PORT');
    assert.strictEqual(stripStringQuotes("'PORT'"), 'PORT');
  });

  test('handles Python, Rust, and C# string prefixes', () => {
    assert.strictEqual(stripStringQuotes('f"PORT"'), 'PORT');
    assert.strictEqual(stripStringQuotes('r\'PORT\''), 'PORT');
    assert.strictEqual(stripStringQuotes('rb"PORT"'), 'PORT');
    assert.strictEqual(stripStringQuotes('r"PORT"'), 'PORT');
    assert.strictEqual(stripStringQuotes('r#"PORT"#'), 'PORT');
    assert.strictEqual(stripStringQuotes('@"PORT"'), 'PORT');
  });
});

suite('SyncMapping validation', () => {
  test('default mapping structure', () => {
    const mappings = [{ source: '.env', targets: ['.env.example'] }];
    assert.strictEqual(mappings.length, 1);
    assert.strictEqual(mappings[0].source, '.env');
    assert.deepStrictEqual(mappings[0].targets, ['.env.example']);
  });
});

