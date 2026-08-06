const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const WASM_GRAMMARS = [
  'javascript',
  'typescript',
  'tsx',
  'python',
  'rust',
  'php',
  'go',
  'ruby',
  'java',
  'c-sharp',
  'cpp'
];

const copyWasmPlugin = {
  name: 'copy-wasm',
  setup(build) {
    build.onEnd(() => {
      const srcDir = path.join(__dirname, 'node_modules', '@vscode', 'tree-sitter-wasm', 'wasm');
      const outDir = path.join(__dirname, 'dist', 'resources');
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      for (const tag of WASM_GRAMMARS) {
        const file = `tree-sitter-${tag}.wasm`;
        const from = path.join(srcDir, file);
        const to = path.join(outDir, file);
        if (!fs.existsSync(from)) {
          console.warn(`[copy-wasm] missing source: ${from}`);
          continue;
        }
        fs.copyFileSync(from, to);
      }
      console.log(`[copy-wasm] copied ${WASM_GRAMMARS.length} grammar(s) to ${path.relative(__dirname, outDir)}`);
    });
  }
};

const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`[error] ${text}`);
        if (location) {
          console.error(`    at ${location.file}:${location.line}:${location.column}`);
        }
      }
      console.log('[watch] build finished');
    });
  }
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    external: ['vscode', 'web-tree-sitter'],
    outfile: 'dist/extension.js',
    logLevel: 'info',
    plugins: [copyWasmPlugin, problemMatcherPlugin]
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
