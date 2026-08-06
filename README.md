# EnvArchitex

VS Code extension that uses Tree-sitter AST analysis to detect references to environment variables in source code. It infers their data types from usage context and keeps environment template files automatically synchronized — without ever copying real values from `.env`.

## Features

- AST-based detection across **13 programming languages**:
  - JavaScript, TypeScript, JSX, TSX
  - Python
  - Rust
  - PHP
  - Go
  - Ruby
  - Java
  - C#
  - C / C++
- **Configurable Multi-Environment Sync Mappings**: Configure custom source ↔ target env file pairs (e.g. `.env.production` ↔ `.env.production.example`, `.env` ↔ `.env.sample`).
- Type inference (`string` / `number` / `boolean`) from usage context.
- Two-severity diagnostics:
  - `Warning` for variables missing from example/template files.
  - `Information` for variables missing from local env files.
- Quick Fixes (lightbulb) to add missing variables.
- Auto-sync on save (configurable).
- Never reads or copies values from secret env files.

## Settings

- `envarchitex.syncMappings`: Defines source env files and target example/template files to synchronize.
  ```json
  [
    { "source": ".env", "targets": [".env.example", ".env.sample"] },
    { "source": ".env.production", "targets": [".env.production.example"] }
  ]
  ```
- `envarchitex.languages.enabled`: List of language IDs to scan.
- See the **EnvArchitex** section in the Settings UI for sync mode, diagnostics severity, type-inference, ignore globs, and file-size limits.

## Building from source

```bash
npm install
npm run compile
```

Press `F5` to launch an Extension Development Host.

## Commands

- `EnvArchitex: Sync .env.example with detected variables`
- `EnvArchitex: Re-scan workspace`
- `EnvArchitex: Toggle auto/manual sync`
- `EnvArchitex: Open .env.example`
- `EnvArchitex: Show output channel`

