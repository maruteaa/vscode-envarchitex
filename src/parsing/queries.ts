export type GrammarTag =
  | 'javascript'
  | 'typescript'
  | 'tsx'
  | 'python'
  | 'rust'
  | 'php'
  | 'go'
  | 'ruby'
  | 'java'
  | 'c-sharp'
  | 'cpp';

const JS_TS_TSX_QUERY = `
;; process.env.VAR
(member_expression
  object: (member_expression
    object: (identifier) @_proc (#eq? @_proc "process")
    property: (property_identifier) @_env (#eq? @_env "env"))
  property: (property_identifier) @var_name) @ref

;; process.env['VAR']  or  process.env["VAR"]
(subscript_expression
  object: (member_expression
    object: (identifier) @_proc2 (#eq? @_proc2 "process")
    property: (property_identifier) @_env2 (#eq? @_env2 "env"))
  index: (string) @var_name_string) @ref

;; const { VAR, OTHER } = process.env
(variable_declarator
  name: (object_pattern
    (shorthand_property_identifier_pattern) @var_name)
  value: (member_expression
    object: (identifier) @_proc3 (#eq? @_proc3 "process")
    property: (property_identifier) @_env3 (#eq? @_env3 "env"))) @ref

;; const { VAR: alias } = process.env (renamed destructure)
(variable_declarator
  name: (object_pattern
    (pair_pattern
      key: (property_identifier) @var_name
      value: (_)))
  value: (member_expression
    object: (identifier) @_proc4 (#eq? @_proc4 "process")
    property: (property_identifier) @_env4 (#eq? @_env4 "env"))) @ref
`;

const PYTHON_QUERY = `
;; os.environ['VAR']  or  os.environ["VAR"]
(subscript
  value: (attribute
    object: (identifier) @_os (#eq? @_os "os")
    attribute: (identifier) @_env (#eq? @_env "environ"))
  subscript: (string) @var_name_string) @ref

;; os.environ.get('VAR') or os.environ.get('VAR', default)
(call
  function: (attribute
    object: (attribute
      object: (identifier) @_os2 (#eq? @_os2 "os")
      attribute: (identifier) @_env2 (#eq? @_env2 "environ"))
    attribute: (identifier) @_get (#eq? @_get "get"))
  arguments: (argument_list
    .
    (string) @var_name_string
    .
    (_)? @default_value)) @ref

;; os.getenv('VAR') or os.getenv('VAR', default)
(call
  function: (attribute
    object: (identifier) @_os3 (#eq? @_os3 "os")
    attribute: (identifier) @_getenv (#eq? @_getenv "getenv"))
  arguments: (argument_list
    .
    (string) @var_name_string
    .
    (_)? @default_value)) @ref
`;

const RUST_QUERY = `
;; std::env::var("VAR") or env::var("VAR") or std::env::var_os("VAR")
(call_expression
  function: (scoped_identifier
    name: (identifier) @_fn
    (#match? @_fn "^(var|var_os)$"))
  arguments: (arguments
    (string_literal) @var_name_string)) @ref

;; standalone var("VAR") or var_os("VAR")
(call_expression
  function: (identifier) @_fn2
  (#match? @_fn2 "^(var|var_os)$")
  arguments: (arguments
    (string_literal) @var_name_string)) @ref

;; raw string: std::env::var(r#"VAR"#)
(call_expression
  function: (scoped_identifier
    name: (identifier) @_fn3
    (#match? @_fn3 "^(var|var_os)$"))
  arguments: (arguments
    (raw_string_literal) @var_name_string)) @ref

;; standalone raw string: var(r#"VAR"#)
(call_expression
  function: (identifier) @_fn4
  (#match? @_fn4 "^(var|var_os)$")
  arguments: (arguments
    (raw_string_literal) @var_name_string)) @ref
`;

const PHP_QUERY = `
;; getenv('VAR') or env('VAR') or env('VAR', 'default')
(function_call_expression
  function: (name) @_fn (#match? @_fn "^(getenv|env)$")
  arguments: (arguments
    .
    (argument [(string) (encapsed_string)] @var_name_string)
    (argument)? @default_value)) @ref

;; $_ENV['VAR'] or $_SERVER['VAR']
(subscript_expression
  (variable_name (name) @_var (#match? @_var "^(_ENV|_SERVER)$"))
  [(string) (encapsed_string)] @var_name_string) @ref
`;

const GO_QUERY = `
;; os.Getenv("VAR") or os.LookupEnv("VAR")
(call_expression
  function: (selector_expression
    operand: (identifier) @_os (#eq? @_os "os")
    field: (field_identifier) @_fn (#match? @_fn "^(Getenv|LookupEnv)$"))
  arguments: (argument_list
    .
    [(interpreted_string_literal) (raw_string_literal)] @var_name_string)) @ref
`;

const RUBY_QUERY = `
;; ENV['VAR']
(element_reference
  (constant) @_env
  (string) @var_name_string
  (#eq? @_env "ENV")) @ref

;; ENV.fetch('VAR') or ENV.fetch('VAR', 'default')
(call
  receiver: (constant) @_env2
  method: (identifier) @_fetch
  arguments: (argument_list
    .
    (string) @var_name_string
    .
    (_)? @default_value)
  (#eq? @_env2 "ENV")
  (#eq? @_fetch "fetch")) @ref
`;

const JAVA_QUERY = `
;; System.getenv("VAR")
(method_invocation
  object: (identifier) @_sys (#eq? @_sys "System")
  name: (identifier) @_getenv (#eq? @_getenv "getenv")
  arguments: (argument_list . (string_literal) @var_name_string)) @ref

;; System.getenv().get("VAR")
(method_invocation
  object: (method_invocation
    object: (identifier) @_sys2 (#eq? @_sys2 "System")
    name: (identifier) @_getenv2 (#eq? @_getenv2 "getenv"))
  name: (identifier) @_get (#eq? @_get "get")
  arguments: (argument_list . (string_literal) @var_name_string)) @ref
`;

const CSHARP_QUERY = `
;; Environment.GetEnvironmentVariable("VAR")
(invocation_expression
  function: (member_access_expression
    name: (identifier) @_fn (#eq? @_fn "GetEnvironmentVariable"))
  arguments: (argument_list . (argument [(string_literal) (verbatim_string_literal)] @var_name_string))) @ref
`;

const CPP_QUERY = `
;; getenv("VAR") or std::getenv("VAR")
(call_expression
  function: [
    (identifier) @_fn (#eq? @_fn "getenv")
    (qualified_identifier name: (identifier) @_fn2 (#eq? @_fn2 "getenv"))
  ]
  arguments: (argument_list . (string_literal) @var_name_string)) @ref
`;

export function queryFor(tag: GrammarTag): string {
  switch (tag) {
    case 'python':
      return PYTHON_QUERY;
    case 'rust':
      return RUST_QUERY;
    case 'php':
      return PHP_QUERY;
    case 'go':
      return GO_QUERY;
    case 'ruby':
      return RUBY_QUERY;
    case 'java':
      return JAVA_QUERY;
    case 'c-sharp':
      return CSHARP_QUERY;
    case 'cpp':
      return CPP_QUERY;
    default:
      return JS_TS_TSX_QUERY;
  }
}

const VALID_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvKey(key: string): boolean {
  return VALID_KEY_RE.test(key);
}

export function stripStringQuotes(text: string): string {
  let s = text.trim();
  const rustRawMatch = /^r(#*)"(.*)"\1$/.exec(s);
  if (rustRawMatch) {
    return rustRawMatch[2];
  }
  s = s.replace(/^(?:[rRbBuUfF]{1,2}|@)/, '');
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}

