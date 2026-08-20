# EnvArchitex

A VS Code extension that uses **Tree-sitter AST analysis** to detect references to environment variables in source code. It infers their data types from usage context and keeps environment template files automatically synchronized without ever reading or copying real values from `.env`.

## Table of Contents

- [Why EnvArchitex?](#why-envarchitex)
- [Features](#features)
  - [AST-Based Detection](#ast-based-detection)
  - [Supported Languages & Patterns](#supported-languages--patterns)
  - [Type Inference](#type-inference)
  - [Multi-Environment Sync Mappings](#multi-environment-sync-mappings)
  - [Three-Way Sync](#three-way-sync)
  - [Diagnostics](#diagnostics)
  - [Quick Fixes](#quick-fixes)
  - [Status Bar](#status-bar)
- [Commands](#commands)
- [Settings Reference](#settings-reference)
- [How It Works](#how-it-works)
- [Building from Source](#building-from-source)
- [Known Limitations & Weaknesses](#known-limitations--weaknesses)

---

## Why EnvArchitex?

Most projects have a `.env` file containing secrets, and a `.env.example` (or `.env.sample`) that is committed to version control so team members know which variables are needed. Keeping these files in sync manually is tedious and error-prone:

- A developer adds `STRIPE_SECRET_KEY` in code but forgets to add it to `.env.example`.
- A new team member clones the repo and has no idea the variable exists.
- A CI/CD pipeline fails because a required variable was never documented.

**EnvArchitex** solves this by scanning your actual source code using proper AST parsing (not regex), detecting every environment variable reference, and ensuring your template files stay in sync — all automatically on save.

---

## Features

### AST-Based Detection

Unlike regex-based tools, EnvArchitex uses **Tree-sitter** to parse source files into Abstract Syntax Trees. This means it understands the actual structure of your code and only detects genuine environment variable access patterns — not false positives in comments, strings, or unrelated code.

Each supported language has hand-written **S-expression queries** that match the idiomatic patterns for that language. Tree-sitter WASM grammars are loaded on-demand and cached per session, so only the grammars you actually use consume memory.

### Supported Languages & Patterns

EnvArchitex supports **13 language IDs** across **11 Tree-sitter grammars**:

| Language | Language ID(s) | Detected Patterns |
|---|---|---|
| **JavaScript** | `javascript` | `process.env.VAR`, `process.env['VAR']`, `const { VAR } = process.env`, `const { VAR: alias } = process.env` |
| **TypeScript** | `typescript` | Same as JavaScript |
| **JSX** | `javascriptreact` | Same as JavaScript (uses TSX grammar) |
| **TSX** | `typescriptreact` | Same as JavaScript (uses TSX grammar) |
| **Python** | `python` | `os.environ['VAR']`, `os.environ.get('VAR')`, `os.environ.get('VAR', default)`, `os.getenv('VAR')`, `os.getenv('VAR', default)` |
| **Rust** | `rust` | `std::env::var("VAR")`, `env::var("VAR")`, `var("VAR")`, `std::env::var_os("VAR")`, raw strings `var(r#"VAR"#)` |
| **PHP** | `php` | `getenv('VAR')`, `env('VAR')`, `env('VAR', 'default')`, `$_ENV['VAR']`, `$_SERVER['VAR']` |
| **Go** | `go` | `os.Getenv("VAR")`, `os.LookupEnv("VAR")` |
| **Ruby** | `ruby` | `ENV['VAR']`, `ENV.fetch('VAR')`, `ENV.fetch('VAR', default)` |
| **Java** | `java` | `System.getenv("VAR")`, `System.getenv().get("VAR")` |
| **C#** | `csharp` | `Environment.GetEnvironmentVariable("VAR")` (including verbatim strings `@"VAR"`) |
| **C** | `c` | `getenv("VAR")`, `std::getenv("VAR")` (shares C++ grammar) |
| **C++** | `cpp` | `getenv("VAR")`, `std::getenv("VAR")` |

### Type Inference

When enabled (default), EnvArchitex analyses the **surrounding AST context** of each environment variable reference to infer whether it is used as a `string`, `number`, or `boolean`. It walks up to **4 parent nodes** in the AST looking for recognizable patterns.

**How types are inferred per language:**

| Language | `number` signals | `boolean` signals |
|---|---|---|
| **JS/TS** | `parseInt(...)`, `parseFloat(...)`, `Number(...)`, unary `+` | `Boolean(...)`, `!`, `=== "true"`, `=== "false"`, ternary with bool literals |
| **Python** | `int(...)`, `float(...)`, unary `+` / `-` | `bool(...)`, `== "true"`, `== True` |
| **PHP** | `intval(...)`, `floatval(...)`, `(int)` / `(float)` cast | `boolval(...)`, `(bool)` cast |
| **Go** | `strconv.Atoi(...)`, `ParseInt(...)`, `ParseFloat(...)` | `strconv.ParseBool(...)` |
| **Ruby** | `.to_i`, `.to_f` | `==` / `!=` comparisons |
| **Java** | `Integer.parseInt(...)`, `Double.parseDouble(...)`, `Float.parseFloat(...)`, `Long.parseLong(...)` | `Boolean.parseBoolean(...)`, `.equalsIgnoreCase(...)`, `.equals(...)` |
| **C#** | `int.Parse(...)`, `Convert.ToInt32(...)`, `Convert.ToDouble(...)`, `Convert.ToSingle(...)`, `Convert.ToInt64(...)` | `bool.Parse(...)`, `Convert.ToBoolean(...)` |
| **C/C++** | `atoi(...)`, `atof(...)`, `strtol(...)`, `strtod(...)`, `std::stoi(...)`, `std::stod(...)`, `std::stof(...)` | *(not detected)* |
| **Rust** | `.parse()` (generic) | *(not detected)* |

**Default values** are also examined: if `os.getenv('PORT', 8080)` has a numeric default, the type is inferred as `number`. Boolean literal defaults (e.g. `True`, `"false"`) are detected across languages.

When multiple references to the same variable produce different types, the **highest-precedence** type wins: `boolean` > `number` > `string`.

When syncing to `.env.example`, inferred types affect the generated output:
- `string` → `VAR=""`
- `number` → `VAR=0 # type: number`
- `boolean` → `VAR=false # type: boolean`

The inline type comment (`# type: ...`) can be disabled via the `envarchitex.typeInference.emitTypeComment` setting.

### Multi-Environment Sync Mappings

Projects often have multiple environment files for different deployment targets. EnvArchitex supports configurable **source ↔ target** mappings:

```jsonc
// .vscode/settings.json
{
  "envarchitex.syncMappings": [
    { "source": ".env", "targets": [".env.example", ".env.sample"] },
    { "source": ".env.production", "targets": [".env.production.example"] },
    { "source": ".env.staging", "targets": [".env.staging.example"] }
  ]
}
```

Each mapping defines:
- **`source`**: The env file containing real secret values (e.g. `.env`). This file is typically gitignored.
- **`targets`**: One or more template/example files that should mirror the *key names* from the source. These files are committed to version control.

The default mapping is `{ "source": ".env", "targets": [".env.example"] }`.

### Three-Way Sync

EnvArchitex maintains synchronization in **three directions**, each independently configurable:

#### 1. Code → Target (e.g. `.env.example`)
When you save a source file, the extension scans it for environment variable references and appends any missing keys to all configured target files. This is the primary sync direction.

- **Setting**: `envarchitex.syncMode` (`auto` | `manual`)
- **Command**: `EnvArchitex: Sync .env.example with detected variables`

#### 2. Target → Source (e.g. `.env.example` → `.env`)
When you save a target file, any keys present in the target but absent from the source are added to the source file (with empty placeholder values). This ensures your local `.env` always has placeholders for every documented variable.

- **Setting**: `envarchitex.syncEnvFromExample.mode` (`auto` | `manual`)
- **Command**: `EnvArchitex: Sync .env with keys from .env.example`

#### 3. Source → Target (e.g. `.env` → `.env.example`)
When you save a source file, any keys present in the source but absent from the target are added to the target (without copying values). This catches manually-added variables.

- **Setting**: `envarchitex.syncExampleFromEnv.mode` (`auto` | `manual`)
- **Command**: `EnvArchitex: Sync .env.example with keys from .env`

> **Security**: Values are **never** copied from secret `.env` files. Only key names (and inferred type comments) are synchronized to targets.

### Diagnostics

EnvArchitex surfaces two categories of diagnostics directly in your editor as squiggly underlines:

| Diagnostic | Default Severity | Meaning | Setting |
|---|---|---|---|
| `missing-from-example` | ⚠️ Warning | A variable referenced in code is absent from one or more target template files. | `envarchitex.diagnostics.envExample` |
| `missing-from-local` | ℹ️ Information | A variable referenced in code has no value in the local source env file (e.g. `.env`). | `envarchitex.diagnostics.envLocal` |

Each diagnostic can be set to its default severity or `off` to disable it entirely. Diagnostics refresh automatically when you edit or save files, and when env files change on disk.

### Quick Fixes

When the cursor is on a diagnostic underline, the lightbulb (💡) menu offers:

- **`Add 'VAR' to .env.example`** — Appends the variable (with inferred type placeholder) to the target file.
- **`Add 'VAR' to .env (empty placeholder)`** — Appends the variable with an empty value to the local env file.
- **`Add N missing variables to .env.example`** — Batch action when multiple diagnostics are present, adding all missing variables at once.

Quick fixes are available regardless of whether sync mode is `auto` or `manual`, giving you fine-grained control in manual mode.

### Status Bar

EnvArchitex adds a status bar item displaying the current sync mode (e.g. `$(database) EnvArchitex: auto`). Clicking it triggers a sync.

A secondary status bar item appears when the extension has detected new variables to sync but the target file has unsaved changes. It shows how many variables are pending and provides a nudge to save the target file so the sync can proceed.

---

## Commands

All commands are available via the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `EnvArchitex: Sync .env.example with detected variables` | Scans all visible source files for env variable references and appends missing keys to all configured target files. Works regardless of sync mode. |
| `EnvArchitex: Sync .env with keys from .env.example` | For each sync mapping, reads the target template file and ensures the source file (e.g. `.env`) has a placeholder for every key. Useful after pulling new changes. |
| `EnvArchitex: Sync .env.example with keys from .env` | For each sync mapping, reads the source file and ensures the target file(s) have all keys. Values are never copied. |
| `EnvArchitex: Re-scan workspace` | Finds all source files in the workspace (using glob patterns for supported extensions) and refreshes diagnostics for each one. Useful if diagnostics seem stale. |
| `EnvArchitex: Sync all workspace files` | Combines a full workspace scan with a sync — finds all source files and syncs any missing variables to targets. |
| `EnvArchitex: Toggle auto/manual sync` | Switches `envarchitex.syncMode` between `auto` and `manual`. In auto mode, syncs happen on every file save. In manual mode, you must invoke the sync command or use Quick Fixes. |
| `EnvArchitex: Open .env.example` | Opens the target file in the editor. If multiple targets exist, a picker is shown. If the file doesn't exist yet, it is created as an empty file. |
| `EnvArchitex: Show output channel` | Opens the `EnvArchitex` output channel, useful for debugging. The output channel logs every scan, sync, grammar load, and error in detail. |

---

## Settings Reference

All settings live under the `envarchitex` namespace. Open **Settings** (`Ctrl+,`) and search for "EnvArchitex" to see them in the UI.

| Setting | Type | Default | Description |
|---|---|---|---|
| `envarchitex.syncMappings` | `array` | `[{ "source": ".env", "targets": [".env.example"] }]` | Defines source ↔ target pairs. Each entry has a `source` basename and a `targets` array of basenames. |
| `envarchitex.syncMode` | `"auto"` \| `"manual"` | `"auto"` | Controls when **Code → Target** sync runs. `auto` writes on save; `manual` requires the command or Quick Fix. |
| `envarchitex.syncEnvFromExample.mode` | `"auto"` \| `"manual"` | `"auto"` | Controls when **Target → Source** sync runs. `auto` syncs when the target file is saved; `manual` requires the command. |
| `envarchitex.syncExampleFromEnv.mode` | `"auto"` \| `"manual"` | `"auto"` | Controls when **Source → Target** sync runs. `auto` mirrors keys when `.env` is saved; `manual` requires the command. Note: key names added to `.env` will appear in committed files. |
| `envarchitex.diagnostics.envExample` | `"warning"` \| `"off"` | `"warning"` | Severity for variables missing from target template files. |
| `envarchitex.diagnostics.envLocal` | `"info"` \| `"off"` | `"info"` | Severity for variables missing from local `.env`. |
| `envarchitex.languages.enabled` | `string[]` | All 13 languages | Language IDs that EnvArchitex will scan. Remove languages you don't use to reduce noise. |
| `envarchitex.typeInference.enabled` | `boolean` | `true` | Enable/disable type inference from usage context. When disabled, all variables default to `string`. |
| `envarchitex.typeInference.emitTypeComment` | `boolean` | `true` | Append `# type: number` or `# type: boolean` inline comments when syncing non-string variables. |
| `envarchitex.notifications.onSync` | `"always"` \| `"summary"` \| `"off"` | `"always"` | Controls notification popups after a sync. `always` shows per-sync notifications; `off` suppresses them entirely. |
| `envarchitex.ignore.globs` | `string[]` | `["**/node_modules/**", "**/.venv/**", ...]` | Glob patterns for directories/files to skip during scans. Defaults include common vendor/build directories. |
| `envarchitex.maxFileBytes` | `number` | `1048576` (1 MB) | Files larger than this byte size are skipped during scanning. |

---

## How It Works

```
┌─────────────┐    ┌───────────────┐    ┌──────────────────┐    ┌────────────────┐
│ Source File  │───▶│ ParserManager │───▶│ EnvReference     │───▶│ TypeInference  │
│ (JS/TS/Py…) │    │ (Tree-sitter) │    │ Scanner          │    │ Engine         │
└─────────────┘    └───────────────┘    └──────────────────┘    └────────────────┘
                                               │                       │
                                               │ EnvReference[]        │ EnvType
                                               ▼                       ▼
                   ┌───────────────┐    ┌──────────────────┐    ┌────────────────┐
                   │ EnvWorkspace  │◀───│ Diagnostic       │    │ AutoSync       │
                   │ (key tracking)│    │ Orchestrator     │    │ Coordinator    │
                   └───────────────┘    └──────────────────┘    └────────────────┘
                          │                    │                       │
                          │              Diagnostics &           File writes
                          │              Quick Fixes                  │
                          ▼                    ▼                       ▼
                   ┌───────────────┐    ┌──────────────────┐    ┌────────────────┐
                   │ .env          │    │ Editor squiggles │    │ .env.example   │
                   │ .env.prod     │    │ & lightbulb menu │    │ .env.sample    │
                   └───────────────┘    └──────────────────┘    └────────────────┘
```

1. **ParserManager** loads Tree-sitter WASM grammars on-demand and caches them. Each grammar is only loaded when a file of that language is first opened.
2. **EnvReferenceScanner** runs Tree-sitter queries against the AST to extract all environment variable references, including their key names, source locations, and (optionally) default values.
3. **TypeInferenceEngine** walks the AST upward from each reference to determine whether the variable is used as a `string`, `number`, or `boolean`.
4. **EnvWorkspace** watches all tracked env files (`.env`, `.env.example`, etc.) on disk via `FileSystemWatcher`, maintaining an in-memory index of which keys exist in which file.
5. **DiagnosticOrchestrator** compares detected references against the key index and produces editor diagnostics.
6. **EnvCodeActionProvider** generates Quick Fix actions for each diagnostic.
7. **AutoSyncCoordinator** handles the three-way sync logic with debouncing (300 ms), dirty-file detection, and per-file mutex locking to prevent concurrent writes.
8. **EnvExampleWriter** appends new variables under a `# Added by EnvArchitex` header section, preserving existing file content and formatting.
9. **EnvFileParser** is a line-by-line parser for `.env` files that handles quoted values, inline comments, `export` prefixes, and escaped characters.

---

## Building from Source

```bash
# Install dependencies
npm install

# Compile (type-check + lint + esbuild)
npm run compile

# Or watch for changes during development
npm run watch
```

Press **F5** in VS Code to launch an Extension Development Host with the extension loaded.


## Known Limitations & Weaknesses

### Detection Limitations

- **Only idiomatic patterns are detected.** The Tree-sitter queries match specific, standard access patterns (e.g. `process.env.VAR`, `os.Getenv("VAR")`). Non-standard wrappers, custom helper functions (e.g. `getConfig("VAR")`), or framework-specific utilities (e.g. Vite's `import.meta.env.VAR`, Next.js `NEXT_PUBLIC_*` via bundler injection, `dotenv.config()` return values) are **not** detected.

- **Dynamic key names are invisible.** Variables accessed via computed keys — such as `process.env[someVariable]`, `os.environ.get(key)`, or `os.Getenv(configMap[name])` — cannot be detected because the key name is not a static string literal in the AST.

- **No cross-file or import-chain tracking.** If a variable is defined in one module and re-exported or passed as a parameter to another, only the file containing the actual env access call is scanned. There is no data-flow analysis across module boundaries.

- **String concatenation / template literals are not resolved.** Patterns like `` process.env[`PREFIX_${name}`] `` are not matched.

### Type Inference Limitations

- **Heuristic-based, not type-system-based.** Type inference walks the AST looking for recognizable function wrappers and operators. It does **not** use TypeScript's type checker, Python's type annotations, or any language server. This means some patterns may be missed or misidentified.

- **Limited parent depth.** The inference engine walks only **4 levels** up the AST tree. Deeply nested expressions like `someFunc(otherFunc(parseInt(process.env.PORT)))` may not be reached.

- **Ambiguity with shared function names.** In Java and C#, some function names like `Parse` and `valueOf` appear in both numeric and boolean contexts. The engine may resolve these incorrectly depending on which AST branch it encounters first.

- **No inference for C/C++ booleans or Rust booleans.** The extension does not detect boolean usage patterns in C, C++, or Rust — all variables default to `string` unless a numeric conversion function is found.

- **Aggregation may mask nuance.** When the same variable is used as both `number` and `boolean` across different files, the highest-precedence type (`boolean` > `number` > `string`) wins globally. This may not match every individual usage site.

### Sync & Workspace Limitations

- **Single-level file structure only.** Env files are matched by **basename** (e.g. `.env`, `.env.example`) and are expected to live in the **workspace folder root**. Nested env files (e.g. `packages/api/.env`) are not handled by the sync mapping system.

- **No variable removal or cleanup.** If you remove an environment variable from your code, EnvArchitex will **not** remove it from `.env.example`. The extension only adds; it never deletes. Over time, template files may accumulate stale entries.

- **No ordering or grouping.** Synced variables are appended to the end of the file under a `# Added by EnvArchitex` header. There is no support for sorting alphabetically, grouping by feature, or preserving any organizational structure.

- **Dirty-file deferral without automatic retry.** If a target file has unsaved changes when a sync is triggered, the sync is deferred and a status bar hint is shown. However, there is no automatic retry once the file is saved — a new source file save is needed to re-trigger the sync.

- **Workspace scan opens all source files.** The `Re-scan workspace` and `Sync all workspace files` commands use `vscode.workspace.openTextDocument()` for every matched file. In very large workspaces, this may be slow and memory-intensive.

### General Limitations

- **Requires Tree-sitter WASM grammars bundled in the extension.** If a grammar `.wasm` file is missing from the `dist/resources/` directory, that language will not be scanned, and a warning toast will appear once per session.

- **No multi-root workspace awareness for sync mappings.** The sync mappings configuration is global. While the extension does iterate over all workspace folders, you cannot define different sync mappings for different workspace roots.

- **No `.env` file format validation.** The env file parser is tolerant and may silently misparse edge cases with complex multiline values, heredoc syntax, or unusual escaping schemes.

- **Diagnostics are file-scoped.** When multiple source files reference the same variable, each file independently produces diagnostics. Fixing the diagnostic in one file (via Quick Fix) does not immediately clear the diagnostic in others until those files are re-scanned.

- **Glob matching is a simplified implementation.** The `DiagnosticOrchestrator` uses a custom glob-to-regex converter rather than a full glob library. Complex glob patterns with brace expansion or character classes may not behave as expected.
