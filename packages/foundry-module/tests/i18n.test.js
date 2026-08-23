import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = join(MODULE_ROOT, "scripts");
const TEMPLATES_DIR = join(MODULE_ROOT, "templates");
const LANGUAGE_FILE = join(MODULE_ROOT, "languages", "en.json");
const EXCLUDED_SCRIPT_DIRS = new Set(["generated", "vendor"]);

// Wire and protocol text answers the CLI, never the GM's screen, so it stays English by design.
// The exemption is only safe while these files neither localize nor notify; both are asserted below.
const WIRE_TEXT_FILES = ["lib/errors.js", "lib/batch-guards.js", "command-router.js"];
// The scripts that write on the GM's screen, declared rather than derived from "names a catalog key":
// a file that localizes nothing would otherwise exempt itself from the lints scoped here simply by
// writing no key, and enrolling it must stay possible. The boundary assertions below fail when a
// localizing script is missing from this list, and when an entry names a file the tree no longer ships.
const GM_TEXT_FILES = [
  "authorization.js",
  "bridge-client.js",
  "command-permissions.js",
  "index.js",
  "lib/bridge-status.js",
  "lib/startup.js",
  "scene-controls.js"
];

const KEY_PATTERN = /FVTTWORLDCLI(?:\.[A-Za-z0-9_]+)+/g;
const DYNAMIC_KEY_PATTERN = /FVTTWORLDCLI[A-Za-z0-9_.]*\$\{/g;
const NOTIFICATION_PATTERN = /notifications\s*\??\.\s*(?:info|warn|error|success|notify)\s*\??\.?\(/g;
const WARNING_HELPER_PATTERN = /warnBridgeDisabled\s*\(/g;
const WARNING_PAYLOAD_PATTERN = /\bwarn\s*:\s*\{/g;
// Every declaration form a builder can take, because a call site trusts the name alone: `export
// function` was the only form read while `function` and `const … = () =>` shipped raw English past it.
const WARNING_BUILDER_PATTERN = /(?:export\s+)?(?:function|const)\s+(get\w*WarningMessage)\b/g;
const FUNCTION_DECLARATION_PATTERN =
  /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
const WARNING_BUILDER_CALL_PATTERN = /(?<![\w$.])(get\w*WarningMessage)\s*\(/g;
const WARNING_BUILDER_RETURN_PATTERN = /\breturn\s+([^;]+);/g;
const MESSAGE_PROPERTY_PATTERN = /^message\s*:\s*([\s\S]+)$/;
const LOCALIZED_CALL_PATTERN = /^(?:localize|format|get\w*WarningMessage)\s*\(/;
const REFERENCE_ARGUMENT_PATTERN = /^[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*$/;
// The two relay parameters that forward text their caller already chose: `warnBridgeDisabled` passes
// its `message` on to the notification, and the terminal-stop path passes `warn.message` on to it.
const RELAY_TEXT_ARGUMENTS = new Set(["message", "warn.message"]);
const ERROR_CONSTRUCTION_PATTERN = /\bnew Error\s*\(/g;
const COERCED_TEXT_PATTERN = /^String\(\s*[A-Za-z_$][\w$]*\s*\)$/;
const RELAYED_MESSAGE_PATTERN = /(?:^|\.)message$/;
const FORMAT_CALL_PATTERN = /(?<!function\s)\bformat\s*\(/g;
const LOCALIZE_CALL_PATTERN = /(?<!function\s)\blocalize\s*\(/g;
const KEY_LITERAL_PATTERN = /^"(FVTTWORLDCLI(?:\.[A-Za-z0-9_]+)+)"$/;
const KEY_MAP_LOOKUP_PATTERN = /^([A-Za-z_$][\w$]*)\[/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const PLACEHOLDER_PATTERN = /{[^}]+}/g;
const PROPERTY_PATTERN = /^([A-Za-z_$][\w$]*)\s*(?::|$)/;
const TEMPLATE_LOCALIZE_PATTERN = /{{\s*localize\s+"(FVTTWORLDCLI(?:\.[A-Za-z0-9_]+)+)"([^}]*)}}/g;
const TEMPLATE_CONTEXT_LOCALIZE_PATTERN = /{{\s*localize\s+([A-Za-z_$][\w$]*)\s*}}/g;
const TEMPLATE_HASH_ENTRY_PATTERN = /([A-Za-z_$][\w$]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s}]*)/g;
const TEMPLATE_COMMENT_PATTERN = /{{!--[\s\S]*?--}}|{{![\s\S]*?}}/g;
const TEMPLATE_MUSTACHE_PATTERN = /{{[^}]*}}+/g;
const TEMPLATE_TAG_PATTERN = /<[^>]*>/g;
const TEMPLATE_ENTITY_PATTERN = /&[A-Za-z][A-Za-z0-9]*;|&#\d+;/g;
const TEMPLATE_TEXT_ATTRIBUTE_PATTERN =
  /\b(?:data-tooltip|placeholder|aria-label|title|alt)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const KEY_MAP_REFERENCE_PATTERN = /([A-Za-z_$][\w$]*)\s*\[/g;
// Every spelling a string literal has, the template literal included: `${MODULE_TITLE} status` is the
// natural way to write the module-branded option text these lints exist to refuse, and a pattern
// reading only double quotes would pass it. The alternation stays non-capturing inside one wrapping
// group so the literal remains the second capture the readers below index by position.
const TEXT_LITERAL_SOURCE = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'` + "|`[^`]*`";
// Anchoring each of the three patterns below on the character that opens a property keeps a conditional
// out of the match: the `label` in `LABEL_PATTERN.test(label) ? label : ""` is a value being returned,
// not an option being declared.
/** @param {string} names */
const textPropertyPattern = (names) =>
  new RegExp(String.raw`(?<=[{,\n]\s*)(${names})\s*:\s*(${TEXT_LITERAL_SOURCE})`, "g");
const OPTION_TEXT_PROPERTY_PATTERN = textPropertyPattern("title|hint");
// `label` names an internal field in handler code as readily as a Foundry option, so its free-standing
// form is read as UI text only where the file writes on the GM's screen.
const OPTION_LABEL_PROPERTY_PATTERN = textPropertyPattern("label");
const REGISTRATION_TEXT_PROPERTY_PATTERN = textPropertyPattern("name|label");
const SETTINGS_REGISTRATION_PATTERN = /settings\s*\??\.\s*register(?:Menu)?\s*\(/g;
const KEY_TEXT_PATTERN = /^FVTTWORLDCLI(?:\.[A-Za-z0-9_]+)+$/;
const STRING_LITERAL_PATTERN = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
const TEXT_LITERAL_PATTERN = new RegExp(TEXT_LITERAL_SOURCE, "g");
const INTERPOLATION_PATTERN = /\$\{[^}]*}/g;
const READABLE_TEXT_PATTERN = /\p{L}/u;
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->/g;

function listFiles(dir, extension, excludedDirs = new Set()) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(join(current, entry.name));
        continue;
      }
      if (entry.name.endsWith(extension)) files.push(join(current, entry.name));
    }
  };
  walk(dir);
  return files;
}

function readSources(dir, extension, excludedDirs) {
  return listFiles(dir, extension, excludedDirs).map((path) => ({
    path: relative(MODULE_ROOT, path),
    source: readFileSync(path, "utf8")
  }));
}

// Prose is not a reference: a comment naming a key keeps its leaf out of the orphan report, so the
// last call site can be deleted and the dead string still reads as live. Removing comments here and
// nowhere else keeps a mistake loud — a lost key fails the catalog checks, where a lost offender in
// one of the lints below would just pass.
function collectKeyReferences(source) {
  const code = source.replace(TEMPLATE_COMMENT_PATTERN, "").replace(COMMENT_PATTERN, "");
  return [...code.matchAll(KEY_PATTERN)].map(([key]) => key);
}

function findDynamicKeyReferences(source) {
  return [...source.matchAll(DYNAMIC_KEY_PATTERN)].map(([reference]) => reference);
}

function readCallArguments(source, openIndex) {
  const args = [];
  let depth = 0;
  let start = openIndex + 1;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, index));
        return args;
      }
    } else if (character === "," && depth === 1) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
  }
  return args;
}

function findCallArguments(source, pattern, position) {
  return [...source.matchAll(pattern)]
    .map((match) => readCallArguments(source, match.index + match[0].length - 1)[position])
    .filter((argument) => argument !== undefined)
    .map((argument) => argument.trim().replace(/\s+/g, " "));
}

function closingParenIndex(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if ("([{".includes(text[index])) depth += 1;
    else if (")]}".includes(text[index])) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

// A localizer call is only as good as the key it is handed, and Foundry's Localization#localize
// returns a string it cannot resolve unchanged (v13 client/helpers/localization.mjs, v14 :435-445), so
// `localize(paired ? "FVTTWORLDCLI.A.B" : "Pair this browser first.")` renders raw English on every
// locale while spanning the argument as one whole call. Only the key expression is read: a placeholder
// value belongs to findAuthoredDataValues below, which reads the format data the key is rendered with.
function findAuthoredKeyLiterals(argument) {
  const call = LOCALIZED_CALL_PATTERN.exec(argument);
  if (!call) return [];
  const [key] = readCallArguments(argument, call[0].length - 1);
  return authoredTextLiterals(key ?? "");
}

// Accepting a localizer call only when it spans the whole argument is what rejects a sentence glued
// from fragments: `localize(key) + ": " + detail` leaves text beyond the call's closing paren.
function isCatalogTextArgument(argument) {
  const call = LOCALIZED_CALL_PATTERN.exec(argument);
  if (!call) return false;
  if (closingParenIndex(argument, call[0].length - 1) !== argument.length - 1) return false;
  return !findAuthoredKeyLiterals(argument).length;
}

function bindsAuthoredText(name, source) {
  const assignments = source.matchAll(new RegExp(`\\b${name}\\b\\s*(?:\\+=|=(?![=>]))([^;]*)`, "g"));
  return [...assignments].some(
    ([, expression]) => !isCatalogTextArgument(expression.trim().replace(/\s+/g, " "))
  );
}

// A relay name is the one bare reference a call site may pass, and only while every binding of it in the
// file is one whole catalog call: `const message = format(key, data) + " Retry from Authorization."` is a
// sentence authored right here, and reading it back through the relay's own name would otherwise walk
// past every check above. An appended fragment fails for the same reason a rebinding does.
function isLocalizedTextArgument(argument, source) {
  if (RELAY_TEXT_ARGUMENTS.has(argument)) return !bindsAuthoredText(argument.split(".")[0], source);
  return isCatalogTextArgument(argument);
}

function findUnlocalizedNotifications(source) {
  return findCallArguments(source, NOTIFICATION_PATTERN, 0).filter(
    (argument) => !isLocalizedTextArgument(argument, source)
  );
}

function findUnlocalizedWarningMessages(source) {
  return findCallArguments(source, WARNING_HELPER_PATTERN, 1).filter(
    (argument) => !isLocalizedTextArgument(argument, source)
  );
}

// An Error a GM-facing file throws is GM-facing text: the failure notifications render it through their
// `{error}` placeholder. Text that arrives from elsewhere passes — a daemon error's `message`, a coerced
// non-Error rejection — and so does a catalog call behind a `??` fallback. Only the declared GM-facing
// files are read, and the scope is a product decision rather than a limit of the lint: wire and protocol
// error text answers the CLI in English by design, and AGENTS.md reserves `new Error` elsewhere for
// states that cannot occur, so a wire message relayed through an `{error}` placeholder is accepted.
function findUnlocalizedErrorMessages(source) {
  const offenders = [];
  for (const match of source.matchAll(ERROR_CONSTRUCTION_PATTERN)) {
    const [argument] = readCallArguments(source, match.index + match[0].length - 1);
    if (argument === undefined) continue;
    const normalized = argument.trim().replace(/\s+/g, " ");
    const localized = splitTopLevel(normalized, "??").every(
      (part) =>
        isLocalizedTextArgument(part, source) ||
        COERCED_TEXT_PATTERN.test(part) ||
        (REFERENCE_ARGUMENT_PATTERN.test(part) && RELAYED_MESSAGE_PATTERN.test(part))
    );
    if (!localized) offenders.push(normalized);
  }
  return offenders;
}

// The permanent GM warnings travel as `warn: { message, details }` payloads, so the text is chosen at
// the construction site and the relay only forwards `warn.message`. Linting the payload is what keeps
// a new terminal-stop reason from shipping an inline literal past the relay's bare-reference check.
function findUnlocalizedWarningPayloads(source) {
  const offenders = [];
  for (const match of source.matchAll(WARNING_PAYLOAD_PATTERN)) {
    const open = match.index + match[0].length - 1;
    const body = source.slice(open + 1, closingParenIndex(source, open));
    const message = splitTopLevel(body)
      .map((part) => MESSAGE_PROPERTY_PATTERN.exec(part)?.[1])
      .find((value) => value !== undefined);
    if (message === undefined) continue;
    const argument = message.trim().replace(/\s+/g, " ");
    if (!isLocalizedTextArgument(argument, source)) offenders.push(argument);
  }
  return offenders;
}

// A declaration ends at the brace that closes a function body or at the semicolon that ends a
// `const … = () => expression`, whichever comes first at depth zero.
function readBuilderDeclaration(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) {
      depth -= 1;
      if (depth === 0 && character === "}") return source.slice(start, index + 1);
    } else if (character === ";" && depth === 0) return source.slice(start, index);
  }
  return source.slice(start);
}

// A concise arrow returns without saying so, so its body is the branch when no return statement is
// written; a declaration that yields neither is reported rather than trusted. A braced body is not a
// branch — reading it as one would make every literal a function merely mentions a returned value.
function readBuilderBranches(declaration) {
  const returns = [...declaration.matchAll(WARNING_BUILDER_RETURN_PATTERN)]
    .map(([, expression]) => expression.trim().replace(/\s+/g, " "))
    .flatMap((expression) => conditionalBranches(expression));
  if (returns.length) return returns;
  const arrow = splitTopLevel(declaration, "=>");
  if (arrow.length < 2) return [];
  const body = arrow.slice(1).join("=>").trim().replace(/\s+/g, " ");
  return body.startsWith("{") ? [] : conditionalBranches(body);
}

function findWarningBuilders(source) {
  return [...source.matchAll(WARNING_BUILDER_PATTERN)].map((match) => ({
    name: match[1],
    branches: readBuilderBranches(readBuilderDeclaration(source, match.index))
  }));
}

function findWarningBuilderCalls(source) {
  return [...source.matchAll(WARNING_BUILDER_CALL_PATTERN)].map(([, name]) => name);
}

// A builder's return value becomes the whole permanent notification, so every value it can return must
// be one catalog call spanning the expression. Asking only whether a localizer appears anywhere in the
// body would accept `format(key, data) + " Slot: 2."`, the fragment assembly these builders exist to
// prevent, because the localized part is still there.
function findUnlocalizedWarningBuilders(source) {
  return findWarningBuilders(source)
    .filter(({ branches }) => !branches.length || !branches.every((branch) => isCatalogTextArgument(branch)))
    .map(({ name }) => name);
}

// Only the values a conditional selects are text; its test is not, so a `reason ? … : …` return is read
// as its two branches.
function conditionalBranches(expression) {
  const parts = splitTopLevel(expression, "?");
  if (parts.length === 1) return parts;
  return parts.slice(1).flatMap((part) => splitTopLevel(part, ":"));
}

// The quotes are stripped rather than matched: a key stays a key in whichever spelling it is written,
// and the key lints above read it out of the source without caring either.
function findLiteralProperties(source, pattern) {
  return [...source.matchAll(pattern)]
    .filter(([, , literal]) => !KEY_TEXT_PATTERN.test(literal.slice(1, -1)))
    .map(([, property, literal]) => `${property}: ${literal}`);
}

// Text handed to Foundry as an option value reaches the GM without passing a localizer call at all: an
// ApplicationV2 `window.title`, a scene-control tool's `title`, a registered setting's `name`, `hint` or
// `label`. Every script is read, including one that names no catalog key: a settings registration and a
// window title are GM-facing wherever they are written, and a new file with neither a localizer call nor
// a notification would otherwise exempt itself. Coverage stays narrow instead — a value that is not a
// bare string literal comes from world data, and `name` is UI text only inside a registration.
function findUnlocalizedOptionTexts(source) {
  const offenders = findLiteralProperties(source, OPTION_TEXT_PROPERTY_PATTERN);
  for (const match of source.matchAll(SETTINGS_REGISTRATION_PATTERN)) {
    const args = readCallArguments(source, match.index + match[0].length - 1);
    offenders.push(...findLiteralProperties(args.at(-1) ?? "", REGISTRATION_TEXT_PROPERTY_PATTERN));
  }
  return offenders;
}

function findUnlocalizedLabelOptions(source) {
  return findLiteralProperties(source, OPTION_LABEL_PROPERTY_PATTERN);
}

function splitTopLevel(text, separator = ",") {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth -= 1;
    else if (depth === 0 && text.startsWith(separator, index)) {
      parts.push(text.slice(start, index));
      index += separator.length - 1;
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function readObjectProperties(argument) {
  if (!argument?.startsWith("{") || !argument.endsWith("}")) return null;
  const entries = [];
  for (const part of splitTopLevel(argument.slice(1, -1))) {
    const name = PROPERTY_PATTERN.exec(part)?.[1];
    if (name === undefined) return null;
    entries.push({ name, value: part.slice(name.length).replace(/^\s*:\s*/, "") });
  }
  return entries;
}

// Text an expression writes itself rather than taking from the catalog. Interpolation and punctuation
// are data — a letter makes it prose — and a key is a reference, so neither counts.
function authoredTextLiterals(expression) {
  return [...expression.matchAll(TEXT_LITERAL_PATTERN)]
    .map(([literal]) => ({ literal, text: literal.slice(1, -1) }))
    .filter(
      ({ text }) =>
        !KEY_TEXT_PATTERN.test(text.trim()) &&
        READABLE_TEXT_PATTERN.test(text.replace(INTERPOLATION_PATTERN, ""))
    )
    .map(({ literal }) => literal);
}

// A placeholder's value is rendered inside the catalog's own sentence, and every check around it reads
// placeholder names only, so `{ reason: "no reason" }` splices an English fragment into a translated
// string with nothing to catch it.
function findAuthoredDataValues(entries) {
  return entries.flatMap(({ name, value }) =>
    authoredTextLiterals(value).map((literal) => `{${name}}: supplies readable text ${literal}`)
  );
}

function readPlaceholders(key, catalogRoot) {
  const value = key.split(".").reduce((branch, part) => branch?.[part], catalogRoot);
  return typeof value !== "string"
    ? null
    : (value.match(PLACEHOLDER_PATTERN) ?? []).map((placeholder) => placeholder.slice(1, -1));
}

// A key a local name holds is written where the name is bound, so the placeholder checks read the
// binding: `localize(detailKey)` selects whichever key that branch chose. The visited set is what keeps
// a name bound in terms of itself from resolving forever.
function resolveBoundKeyExpression(name, source, visited) {
  if (visited.has(name)) return null;
  visited.add(name);
  const binding = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=([^;]*)`).exec(source);
  if (!binding) return null;
  const keys = conditionalBranches(binding[1].trim().replace(/\s+/g, " ")).flatMap(
    (branch) => resolveKeyExpression(branch, source, visited) ?? []
  );
  return keys.length ? keys : null;
}

function resolveKeyExpression(expression, source, visited = new Set()) {
  const literal = KEY_LITERAL_PATTERN.exec(expression);
  if (literal) return [literal[1]];
  if (IDENTIFIER_PATTERN.test(expression)) return resolveBoundKeyExpression(expression, source, visited);
  const lookup = KEY_MAP_LOOKUP_PATTERN.exec(expression);
  if (!lookup) return null;
  const declaration = new RegExp(`const ${lookup[1]} = Object\\.freeze\\(\\{[^}]*\\}\\)`).exec(source);
  const keys = declaration ? [...declaration[0].matchAll(KEY_PATTERN)].map(([key]) => key) : [];
  return keys.length ? keys : null;
}

// A catalog string may name one placeholder twice, so the contract is the set of names, not the list.
function uniqueNames(names) {
  return [...new Set(names)].sort().join();
}

function findPlaceholderMismatches(source, catalogRoot) {
  const mismatches = [];
  for (const match of source.matchAll(FORMAT_CALL_PATTERN)) {
    const args = readCallArguments(source, match.index + match[0].length - 1).map((argument) =>
      argument.trim().replace(/\s+/g, " ")
    );
    const keys = resolveKeyExpression(args[0] ?? "", source);
    const supplied = readObjectProperties(args[1]);
    if (!keys || !supplied) {
      mismatches.push(`unreadable format contract: format(${args[0] ?? ""}, ${args[1] ?? ""})`);
      continue;
    }
    const names = supplied.map(({ name }) => name);
    mismatches.push(...findAuthoredDataValues(supplied));
    for (const key of keys) {
      const placeholders = readPlaceholders(key, catalogRoot);
      if (placeholders === null || uniqueNames(placeholders) !== uniqueNames(names))
        mismatches.push(
          `${key}: supplies ${names.join()}, the catalog declares ${placeholders?.join() || "nothing"}`
        );
    }
  }
  return mismatches;
}

// Reading the key expression the way the placeholder check does, rather than a literal only: every key
// a map or a local name can select is localized by this call site, and one of them carrying a
// placeholder renders its raw braces to the GM. A key no source writes down stays unread.
function findFormattedLocalizeCalls(source, catalogRoot) {
  const offenders = [];
  for (const match of source.matchAll(LOCALIZE_CALL_PATTERN)) {
    const [argument] = readCallArguments(source, match.index + match[0].length - 1);
    const keys = resolveKeyExpression((argument ?? "").trim().replace(/\s+/g, " "), source) ?? [];
    for (const key of keys) if (readPlaceholders(key, catalogRoot)?.length) offenders.push(key);
  }
  return offenders;
}

function localizerCalls(source) {
  return [...source.matchAll(LOCALIZE_CALL_PATTERN), ...source.matchAll(FORMAT_CALL_PATTERN)].sort(
    (left, right) => left.index - right.index
  );
}

// The sentence a locale translates is the catalog's, so a localizer call is the whole text or none of
// it. Every call-site lint above reads one seam — a notification argument, a warning payload, a builder
// return — and text glued around a catalog call anywhere else, a context field a bare `{{…}}` mustache
// prints verbatim included, would reach the GM with no seam to read it at. Every operator that appends
// counts, `+=` included, because a sentence grown one statement at a time is still assembled here.
const APPENDING_OPERATORS = ["+", "+=", "${"];

function findAssembledCatalogText(source) {
  const offenders = [];
  for (const match of localizerCalls(source)) {
    const closing = closingParenIndex(source, match.index + match[0].length - 1);
    const before = source.slice(0, match.index).trimEnd();
    const after = closing === -1 ? "" : source.slice(closing + 1).trimStart();
    if (!APPENDING_OPERATORS.some((operator) => before.endsWith(operator)) && !after.startsWith("+"))
      continue;
    offenders.push(
      source
        .slice(match.index, closing === -1 ? source.length : closing + 1)
        .trim()
        .replace(/\s+/g, " ")
    );
  }
  return offenders;
}

// A function that returns catalog text is producing a GM-facing sentence, and its value is rendered as
// it stands, so a readable literal in any branch is text this file authored. Qualification is derived
// from the branches rather than declared: a function whose returns never reach the catalog is answering
// with data — `resolveDisplayState` returns "unpaired" as a state name, not as words.
function findAuthoredProducerTexts(source) {
  const offenders = [];
  for (const match of source.matchAll(FUNCTION_DECLARATION_PATTERN)) {
    const name = match[1] ?? match[2];
    const branches = readBuilderBranches(readBuilderDeclaration(source, match.index));
    if (!branches.some((branch) => localizerCalls(branch).length)) continue;
    for (const branch of branches)
      offenders.push(
        ...authoredTextLiterals(branch).map((literal) => `${name}: returns readable text ${literal}`)
      );
  }
  return offenders;
}

// Handlebars calls the helper without parentheses, so the script lints above cannot see a template row
// at all. Foundry's helper formats the string when the row carries hash arguments and localizes it when
// it does not (v13 client/applications/handlebars.mjs:253-256, v14 :265-269), which makes the hash the
// row's format data: without it a placeholder-bearing string renders its raw braces to the GM.
// The hash is read as name and value both: a row's value is spliced into the catalog's own sentence
// exactly as a script's format data is, so `detail="Awaiting handshake"` is the same offence there.
function findTemplatePlaceholderMismatches(source, catalogRoot) {
  const mismatches = [];
  for (const [, key, hash] of source.matchAll(TEMPLATE_LOCALIZE_PATTERN)) {
    const entries = [...hash.matchAll(TEMPLATE_HASH_ENTRY_PATTERN)].map(([, name, value]) => ({
      name,
      value
    }));
    const supplied = entries.map(({ name }) => name);
    mismatches.push(...findAuthoredDataValues(entries));
    const placeholders = readPlaceholders(key, catalogRoot);
    if (placeholders === null || uniqueNames(placeholders) !== uniqueNames(supplied))
      mismatches.push(
        `${key}: supplies ${supplied.join() || "nothing"}, the catalog declares ${
          placeholders?.join() || "nothing"
        }`
      );
  }
  return mismatches;
}

function findTemplateTextNodes(source) {
  return source
    .replace(TEMPLATE_COMMENT_PATTERN, "")
    .replace(TEMPLATE_MUSTACHE_PATTERN, "")
    .replace(TEMPLATE_TAG_PATTERN, "")
    .replace(TEMPLATE_ENTITY_PATTERN, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// An attribute renders to the GM as readily as a text node — `data-tooltip` is how the label field
// explains itself — and the text-node lint above drops whole tags, so it can never see one. Mustaches go
// first, which leaves a localized attribute empty and an authored one readable.
function findTemplateAttributeTexts(source) {
  const stripped = source.replace(TEMPLATE_COMMENT_PATTERN, "").replace(TEMPLATE_MUSTACHE_PATTERN, "");
  return [...stripped.matchAll(TEMPLATE_TEXT_ATTRIBUTE_PATTERN)]
    .map(([, doubleQuoted, singleQuoted]) => (doubleQuoted ?? singleQuoted).trim())
    .filter(Boolean);
}

function readPropertyExpression(source, colonIndex) {
  let depth = 0;
  for (let index = colonIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) {
      if (depth === 0) return source.slice(colonIndex + 1, index);
      depth -= 1;
    } else if (character === "," && depth === 0) return source.slice(colonIndex + 1, index);
  }
  return source.slice(colonIndex + 1);
}

function resolveKeyMapKeys(name, sources) {
  for (const { source } of sources) {
    const keys = resolveKeyExpression(`${name}[key]`, source);
    if (keys) return keys;
  }
  return null;
}

function readBoundLiterals(expression) {
  return [...expression.matchAll(STRING_LITERAL_PATTERN)]
    .map(([, doubleQuoted, singleQuoted]) => (doubleQuoted ?? singleQuoted).trim())
    .filter(Boolean);
}

// A template row may name its key through a context field, and the script that binds the field is the
// only place the reachable keys are written down. A branch holding text the catalog cannot answer is
// reported rather than skipped: Foundry's localize returns a non-key unchanged, so a `paired ? key :
// "Pair to name this browser."` field renders raw English on every locale while its sibling key resolves.
function resolveContextKeys(name, sources) {
  const keys = new Set();
  const authored = [];
  let bound = false;
  for (const { source } of sources) {
    for (const match of source.matchAll(new RegExp(`\\b${name}\\s*:`, "g"))) {
      bound = true;
      const expression = readPropertyExpression(source, match.index + match[0].length - 1);
      for (const literal of readBoundLiterals(expression))
        if (KEY_TEXT_PATTERN.test(literal)) keys.add(literal);
        else authored.push(literal);
      for (const [, mapName] of expression.matchAll(KEY_MAP_REFERENCE_PATTERN)) {
        const mapKeys = resolveKeyMapKeys(mapName, sources);
        if (!mapKeys) return { keys: null, authored };
        for (const key of mapKeys) keys.add(key);
      }
    }
  }
  return { keys: bound && keys.size ? [...keys].sort() : null, authored };
}

// Such a row carries no hash, so Foundry localizes it and every key it can select must be
// placeholder-free; the literal-key lint above cannot see the row because its key is not written there.
function findTemplateContextRowMismatches(templateSource, sources, catalogRoot) {
  const mismatches = [];
  for (const [, name] of templateSource.matchAll(TEMPLATE_CONTEXT_LOCALIZE_PATTERN)) {
    const { keys, authored } = resolveContextKeys(name, sources);
    for (const text of authored) mismatches.push(`${name}: binds readable text "${text}"`);
    if (!keys) {
      if (!authored.length) mismatches.push(`unreadable context key: ${name}`);
      continue;
    }
    for (const key of keys) {
      const placeholders = readPlaceholders(key, catalogRoot);
      if (placeholders === null) mismatches.push(`${key}: the catalog resolves it to no string`);
      else if (placeholders.length)
        mismatches.push(`${key}: declares ${placeholders.join()}, a context row can supply nothing`);
    }
  }
  return mismatches;
}

function flattenLeaves(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null ? flattenLeaves(value, path) : [path];
  });
}

// A branch and a blank leaf are both unusable: Foundry renders the key itself for the first and an empty
// label for the second, so neither counts as resolved.
function findUnresolvedKeys(keys, catalogRoot) {
  return [...keys].filter((key) => {
    const value = key.split(".").reduce((branch, part) => branch?.[part], catalogRoot);
    return typeof value !== "string" || !value.trim();
  });
}

function findOrphanLeaves(keys, catalogRoot) {
  return flattenLeaves(catalogRoot).filter((leaf) => !keys.has(leaf));
}

const catalog = JSON.parse(readFileSync(LANGUAGE_FILE, "utf8"));
const CATALOG_ROOT = { FVTTWORLDCLI: catalog.FVTTWORLDCLI };
const scriptSources = readSources(SCRIPTS_DIR, ".js", EXCLUDED_SCRIPT_DIRS);
const templateSources = readSources(TEMPLATES_DIR, ".hbs");
const localizedSources = [...scriptSources, ...templateSources];
const GM_TEXT_PATHS = GM_TEXT_FILES.map((file) => join("scripts", file));
const gmTextSources = scriptSources.filter(({ path }) => GM_TEXT_PATHS.includes(path));

describe("module localization catalog", () => {
  const referenced = new Set(localizedSources.flatMap(({ source }) => collectKeyReferences(source)));

  it("resolves every referenced key to a non-empty string in en.json", () => {
    expect(findUnresolvedKeys(referenced, CATALOG_ROOT)).toEqual([]);
  });

  it("references every string the catalog ships, so no leaf goes stale", () => {
    expect(findOrphanLeaves(referenced, CATALOG_ROOT)).toEqual([]);
  });

  it("names every key in full, so the catalog checks above cannot miss one", () => {
    const dynamic = localizedSources.flatMap(({ path, source }) =>
      findDynamicKeyReferences(source).map((reference) => `${path}: ${reference}`)
    );

    expect(dynamic).toEqual([]);
  });
});

describe("module user-facing text", () => {
  it("takes every Foundry notification's text from the catalog or a warning relay", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findUnlocalizedNotifications(source).map((argument) => `${path}: ${argument}`)
    );

    expect(offenders).toEqual([]);
  });

  it("takes every Error a GM-facing file throws from the catalog or a relayed message", () => {
    const offenders = gmTextSources.flatMap(({ path, source }) =>
      findUnlocalizedErrorMessages(source).map((argument) => `${path}: ${argument}`)
    );

    expect(offenders).toEqual([]);
  });

  it("builds every bridge-disabled warning from the catalog instead of a literal", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findUnlocalizedWarningMessages(source).map((argument) => `${path}: ${argument}`)
    );

    expect(offenders).toEqual([]);
  });

  it("builds every terminal-stop warning payload from the catalog instead of a literal", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findUnlocalizedWarningPayloads(source).map((argument) => `${path}: ${argument}`)
    );

    expect(offenders).toEqual([]);
  });

  it("localizes inside every startup warning builder the notifications relay", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findUnlocalizedWarningBuilders(source).map((name) => `${path}: ${name}`)
    );

    expect(offenders).toEqual([]);
  });

  it("declares every warning builder a call site trusts, so none passes the lints unread", () => {
    const declared = new Set(
      scriptSources.flatMap(({ source }) => findWarningBuilders(source).map(({ name }) => name))
    );
    const untrusted = scriptSources.flatMap(({ path, source }) =>
      findWarningBuilderCalls(source)
        .filter((name) => !declared.has(name))
        .map((name) => `${path}: ${name}`)
    );

    expect(untrusted).toEqual([]);
  });

  it("leaves every catalog call whole, so no script glues a sentence around one", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findAssembledCatalogText(source).map((offender) => `${path}: ${offender}`)
    );

    expect(offenders).toEqual([]);
  });

  it("returns catalog text from every function that produces it, never authored words", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findAuthoredProducerTexts(source).map((offender) => `${path}: ${offender}`)
    );

    expect(offenders).toEqual([]);
  });

  it("supplies exactly the placeholders each formatted string declares", () => {
    const mismatches = scriptSources.flatMap(({ path, source }) =>
      findPlaceholderMismatches(source, catalog).map((mismatch) => `${path}: ${mismatch}`)
    );

    expect(mismatches).toEqual([]);
  });

  it("reserves localize for strings that carry no placeholder", () => {
    const offenders = scriptSources.flatMap(({ path, source }) =>
      findFormattedLocalizeCalls(source, catalog).map((key) => `${path}: ${key}`)
    );

    expect(offenders).toEqual([]);
  });

  it("takes every option value Foundry renders as UI text from the catalog", () => {
    const offenders = [
      ...scriptSources.flatMap(({ path, source }) =>
        findUnlocalizedOptionTexts(source).map((offender) => `${path}: ${offender}`)
      ),
      ...gmTextSources.flatMap(({ path, source }) =>
        findUnlocalizedLabelOptions(source).map((offender) => `${path}: ${offender}`)
      )
    ];

    expect(offenders).toEqual([]);
  });

  it("supplies exactly the format data every template row's string declares", () => {
    const mismatches = templateSources.flatMap(({ path, source }) =>
      findTemplatePlaceholderMismatches(source, catalog).map((mismatch) => `${path}: ${mismatch}`)
    );

    expect(mismatches).toEqual([]);
  });

  it("keeps every template row whose key comes from the context free of placeholders", () => {
    const mismatches = templateSources.flatMap(({ path, source }) =>
      findTemplateContextRowMismatches(source, scriptSources, catalog).map(
        (mismatch) => `${path}: ${mismatch}`
      )
    );

    expect(mismatches).toEqual([]);
  });

  it("leaves no readable text in a template outside a mustache", () => {
    const offenders = templateSources.flatMap(({ path, source }) =>
      findTemplateTextNodes(source).map((text) => `${path}: ${text}`)
    );

    expect(offenders).toEqual([]);
  });

  it("leaves no readable text in a template attribute the GM reads", () => {
    const offenders = templateSources.flatMap(({ path, source }) =>
      findTemplateAttributeTexts(source).map((text) => `${path}: ${text}`)
    );

    expect(offenders).toEqual([]);
  });
});

describe("localization scope boundaries", () => {
  it("names every script that localizes, so the scoped lints cannot silently shrink", () => {
    const undeclared = scriptSources
      .filter(({ source, path }) => collectKeyReferences(source).length && !GM_TEXT_PATHS.includes(path))
      .map(({ path }) => path);

    expect(undeclared).toEqual([]);
  });

  it.each(GM_TEXT_PATHS)("still ships %s, so no declared GM-facing file goes stale", (path) => {
    expect(scriptSources.map((script) => script.path)).toContain(path);
  });

  it.each(WIRE_TEXT_FILES)("still ships %s, so the exemption cannot silently move", (file) => {
    expect(scriptSources.map(({ path }) => path)).toContain(join("scripts", file));
  });

  it.each(WIRE_TEXT_FILES)("keeps %s out of the UI: no catalog key, no notification", (file) => {
    const source = scriptSources.find(({ path }) => path === join("scripts", file))?.source ?? "";

    expect(collectKeyReferences(source)).toEqual([]);
    expect([...source.matchAll(NOTIFICATION_PATTERN)]).toEqual([]);
  });
});

describe("localization lint helpers", () => {
  it("reports a referenced key the catalog answers with a branch, a blank, or nothing", () => {
    const root = { FVTTWORLDCLI: { N: { Pair: "Pair", Blank: "  ", Nested: { Deep: "Deep" } } } };

    expect(
      findUnresolvedKeys(
        ["FVTTWORLDCLI.N.Pair", "FVTTWORLDCLI.N.Blank", "FVTTWORLDCLI.N.Nested", "FVTTWORLDCLI.N.Missing"],
        root
      )
    ).toEqual(["FVTTWORLDCLI.N.Blank", "FVTTWORLDCLI.N.Nested", "FVTTWORLDCLI.N.Missing"]);
  });

  it("reports a catalog leaf no source references, however deep it sits", () => {
    const root = { FVTTWORLDCLI: { N: { Pair: "Pair", Deep: { Unused: "Unused" } } } };

    expect(findOrphanLeaves(new Set(["FVTTWORLDCLI.N.Pair"]), root)).toEqual(["FVTTWORLDCLI.N.Deep.Unused"]);
  });

  it("reads every key a source names in code, and none a comment mentions", () => {
    const source = [
      "// superseded by FVTTWORLDCLI.Dead.LineComment",
      "/** @see FVTTWORLDCLI.Dead.BlockComment */",
      'localize("FVTTWORLDCLI.Missing.Key");'
    ].join("\n");

    expect(collectKeyReferences(source)).toEqual(["FVTTWORLDCLI.Missing.Key"]);
    expect(
      collectKeyReferences('{{!-- FVTTWORLDCLI.Dead.Row --}}{{localize "FVTTWORLDCLI.Live.Row"}}')
    ).toEqual(["FVTTWORLDCLI.Live.Row"]);
  });

  it("reports a key assembled from an interpolated fragment", () => {
    expect(findDynamicKeyReferences("localize(`FVTTWORLDCLI.BridgeStatus.State.${state}`)")).toEqual([
      "FVTTWORLDCLI.BridgeStatus.State.${"
    ]);
  });

  it("reports a notification built from a literal or a concatenation", () => {
    expect(
      findUnlocalizedNotifications('globalThis.ui?.notifications?.info?.("Pairing code: " + code)')
    ).toEqual(['"Pairing code: " + code']);
    expect(
      findUnlocalizedNotifications("notifications.warn(`${MODULE_TITLE} stopped`, { permanent: true })")
    ).toEqual(["`${MODULE_TITLE} stopped`"]);
  });

  it("reports a success notification, the channel a confirmation naturally reaches for", () => {
    expect(findUnlocalizedNotifications('ui?.notifications?.success?.("Pairing revoked.")')).toEqual([
      '"Pairing revoked."'
    ]);
    expect(findUnlocalizedNotifications('ui.notifications.success(localize("FVTTWORLDCLI.A.B"))')).toEqual(
      []
    );
  });

  it("reports a notification glued together from a localized fragment and raw text", () => {
    expect(
      findUnlocalizedNotifications('ui.notifications.error(localize("FVTTWORLDCLI.A.B") + ": " + error)')
    ).toEqual(['localize("FVTTWORLDCLI.A.B") + ": " + error']);
    expect(
      findUnlocalizedNotifications('ui.notifications.error(`${format("FVTTWORLDCLI.A.B", { a })}: ${e}`)')
    ).toEqual(['`${format("FVTTWORLDCLI.A.B", { a })}: ${e}`']);
  });

  it("reports a notification whose localizer is handed authored text instead of a key", () => {
    expect(
      findUnlocalizedNotifications(
        'ui.notifications.warn(localize(paired ? "FVTTWORLDCLI.A.B" : "Pair this browser first."), {})'
      )
    ).toEqual(['localize(paired ? "FVTTWORLDCLI.A.B" : "Pair this browser first.")']);
  });

  it("accepts a notification whose text comes from the catalog, a builder, or a relayed message", () => {
    expect(
      findUnlocalizedNotifications('ui?.notifications?.error?.(format("FVTTWORLDCLI.A.B", { error }), {})')
    ).toEqual([]);
    expect(
      findUnlocalizedNotifications("notifications.warn(getNotPairedWarningMessage(), { permanent: true })")
    ).toEqual([]);
    expect(findUnlocalizedNotifications("notifications.warn(message, { permanent: true })")).toEqual([]);
    expect(findUnlocalizedNotifications("notifications.warn(warn.message)")).toEqual([]);
  });

  it("reports a relayed notification whose sentence the file assembled around a catalog call", () => {
    expect(
      findUnlocalizedNotifications(
        [
          'const message = format("FVTTWORLDCLI.A.B", { error }) + " Retry from Authorization.";',
          "ui.notifications.error(message, { permanent: true });"
        ].join("\n")
      )
    ).toEqual(["message"]);
    expect(
      findUnlocalizedNotifications(
        [
          'let message = localize("FVTTWORLDCLI.A.B");',
          'message += " Retry from Authorization.";',
          "ui.notifications.error(message, { permanent: true });"
        ].join("\n")
      )
    ).toEqual(["message"]);
  });

  it("reports a notification reading back a local literal, relay name or not", () => {
    expect(
      findUnlocalizedNotifications(
        [
          "const message = `${MODULE_TITLE} could not write that.`;",
          "globalThis.ui?.notifications?.warn?.(message);"
        ].join("\n")
      )
    ).toEqual(["message"]);
    expect(
      findUnlocalizedNotifications('const text = "Pairing revoked."; ui.notifications.info(text);')
    ).toEqual(["text"]);
  });

  it("reports an Error whose message is written as raw text", () => {
    expect(
      findUnlocalizedErrorMessages(
        'reject(new Error(`Daemon connection closed (${event.code}): ${event.reason || "no reason"}`));'
      )
    ).toEqual(['`Daemon connection closed (${event.code}): ${event.reason || "no reason"}`']);
    expect(findUnlocalizedErrorMessages('throw new Error("Bridge is not available");')).toEqual([
      '"Bridge is not available"'
    ]);
    expect(
      findUnlocalizedErrorMessages('new Error(localize("FVTTWORLDCLI.A.B") + ": " + event.reason)')
    ).toEqual(['localize("FVTTWORLDCLI.A.B") + ": " + event.reason']);
  });

  it("accepts an Error built from the catalog, a relayed message, or a coerced rejection", () => {
    expect(
      findUnlocalizedErrorMessages(
        'new Error(format("FVTTWORLDCLI.Errors.DaemonClosed", { code: event.code, reason }))'
      )
    ).toEqual([]);
    expect(findUnlocalizedErrorMessages('new Error(localize("FVTTWORLDCLI.Errors.RevokeFailed"))')).toEqual(
      []
    );
    expect(
      findUnlocalizedErrorMessages(
        'new Error(response.error?.message ?? localize("FVTTWORLDCLI.Errors.RevokeFailed"))'
      )
    ).toEqual([]);
    expect(findUnlocalizedErrorMessages("new Error(String(error))")).toEqual([]);
  });

  it("reports a bridge-disabled warning passed as literal text", () => {
    expect(
      findUnlocalizedWarningMessages("warnBridgeDisabled(log, `${MODULE_TITLE} is not paired.`, {})")
    ).toEqual(["`${MODULE_TITLE} is not paired.`"]);
    expect(
      findUnlocalizedWarningMessages('warnBridgeDisabled(log, localize("FVTTWORLDCLI.A.B") + reason, {})')
    ).toEqual(['localize("FVTTWORLDCLI.A.B") + reason']);
  });

  it("accepts a bridge-disabled warning taken from a builder, the catalog, or a relayed message", () => {
    expect(
      findUnlocalizedWarningMessages("warnBridgeDisabled(log, getNotPairedWarningMessage(), {})")
    ).toEqual([]);
    expect(
      findUnlocalizedWarningMessages(
        'warnBridgeDisabled(log, format("FVTTWORLDCLI.Startup.NotPaired", { module: MODULE_TITLE }), {})'
      )
    ).toEqual([]);
    expect(
      findUnlocalizedWarningMessages("warnBridgeDisabled(this.logger, warn.message, warn.details)")
    ).toEqual([]);
  });

  it("reports a terminal-stop warning payload whose message is written inline", () => {
    expect(
      findUnlocalizedWarningPayloads("warn: { message: `${MODULE_TITLE} stopped`, details: { error } }")
    ).toEqual(["`${MODULE_TITLE} stopped`"]);
    expect(
      findUnlocalizedWarningPayloads('warn: { message: localize("FVTTWORLDCLI.A.B") + reason }')
    ).toEqual(['localize("FVTTWORLDCLI.A.B") + reason']);
  });

  it("accepts a warning payload whose message comes from a builder or the catalog", () => {
    expect(
      findUnlocalizedWarningPayloads("warn: { message: getBridgeBusyWarningMessage(), details: { error } }")
    ).toEqual([]);
    expect(
      findUnlocalizedWarningPayloads(
        'warn: { message: format("FVTTWORLDCLI.Startup.NotPaired", { module }), details: {} }'
      )
    ).toEqual([]);
    expect(findUnlocalizedWarningPayloads("warn: { details: { url } }")).toEqual([]);
  });

  it("reports a catalog call glued into a sentence the file assembled around it", () => {
    expect(
      findAssembledCatalogText(
        'return `${format("FVTTWORLDCLI.B.StateDetail", { state, detail })} since the last handshake`;'
      )
    ).toEqual(['format("FVTTWORLDCLI.B.StateDetail", { state, detail })']);
    expect(findAssembledCatalogText('const label = localize("FVTTWORLDCLI.A.B") + ": " + detail;')).toEqual([
      'localize("FVTTWORLDCLI.A.B")'
    ]);
    expect(findAssembledCatalogText('const label = detail + localize("FVTTWORLDCLI.A.B");')).toEqual([
      'localize("FVTTWORLDCLI.A.B")'
    ]);
    expect(findAssembledCatalogText('label += localize("FVTTWORLDCLI.A.B");')).toEqual([
      'localize("FVTTWORLDCLI.A.B")'
    ]);
  });

  it("accepts a catalog call a transform, a fallback, or a conditional selects whole", () => {
    expect(
      findAssembledCatalogText(
        'return toWireLabel(format("FVTTWORLDCLI.A.Default", { user })) || localize("FVTTWORLDCLI.A.Fallback");'
      )
    ).toEqual([]);
    expect(findAssembledCatalogText("return detailKey ? localize(detailKey) : rawStatus;")).toEqual([]);
  });

  it("reports a text producer that returns a sentence of its own", () => {
    const source = [
      "export function describeConnection(displayState, rawStatus) {",
      "  const state = localize(DISPLAY_STATE_LABELS[displayState]);",
      '  if (!rawStatus) return "Awaiting handshake";',
      '  return format("FVTTWORLDCLI.B.StateDetail", { state, detail: rawStatus });',
      "}"
    ].join("\n");

    expect(findAuthoredProducerTexts(source)).toEqual([
      'describeConnection: returns readable text "Awaiting handshake"'
    ]);
  });

  it("accepts a text producer whose every branch answers with the catalog or a reference", () => {
    const source = [
      "export function describeConnection(displayState, rawStatus) {",
      "  const state = localize(DISPLAY_STATE_LABELS[displayState]);",
      "  if (!rawStatus) return state;",
      '  return format("FVTTWORLDCLI.B.StateDetail", { state, detail: rawStatus });',
      "}"
    ].join("\n");

    expect(findAuthoredProducerTexts(source)).toEqual([]);
  });

  it("leaves a function that answers with a state name to the code that reads it", () => {
    const source = [
      "export function resolveDisplayState(credential) {",
      '  if (!credential) return "unpaired";',
      '  return "offline";',
      "}"
    ].join("\n");

    expect(findAuthoredProducerTexts(source)).toEqual([]);
  });

  it("reads a producer's returned value, not every literal its body mentions", () => {
    const source = [
      "const handleAction = async (target) => {",
      '  if (target.dataset.action !== "pair") return;',
      '  ui.notifications.info(localize("FVTTWORLDCLI.N.Paired"));',
      "};"
    ].join("\n");

    expect(findAuthoredProducerTexts(source)).toEqual([]);
  });

  it("reports a producer written as an arrow that appends its own words to the catalog", () => {
    expect(
      findAuthoredProducerTexts(
        'const describeAction = (action) => format("FVTTWORLDCLI.N.Action", { action }) + " now";'
      )
    ).toEqual(['describeAction: returns readable text " now"']);
  });

  it("reports a formatted string whose placeholders and call site disagree", () => {
    const root = {
      FVTTWORLDCLI: { Startup: { Skew: "{module} speaks {expected}, the daemon {actual}" } }
    };

    expect(
      findPlaceholderMismatches('format("FVTTWORLDCLI.Startup.Skew", { module, expected })', root)
    ).toEqual([
      "FVTTWORLDCLI.Startup.Skew: supplies module,expected, the catalog declares module,expected,actual"
    ]);
    expect(
      findPlaceholderMismatches(
        'format("FVTTWORLDCLI.Startup.Skew", { module, expected: a, actual: b })',
        root
      )
    ).toEqual([]);
  });

  it("accepts a call site whose string names one placeholder more than once", () => {
    const root = { FVTTWORLDCLI: { N: { Path: "{module} → Settings → {module}" } } };

    expect(findPlaceholderMismatches('format("FVTTWORLDCLI.N.Path", { module })', root)).toEqual([]);
  });

  it("reports a placeholder value that splices readable text into the catalog's sentence", () => {
    const root = { FVTTWORLDCLI: { N: { Closed: "Closed ({code}): {reason}" } } };

    expect(
      findPlaceholderMismatches(
        'format("FVTTWORLDCLI.N.Closed", { code: event.code, reason: event.reason || "no reason" })',
        root
      )
    ).toEqual(['{reason}: supplies readable text "no reason"']);
    expect(
      findPlaceholderMismatches('format("FVTTWORLDCLI.N.Closed", { code, reason: `${host} is idle` })', root)
    ).toEqual(["{reason}: supplies readable text `${host} is idle`"]);
  });

  it("accepts placeholder values a locale renders: a reference, a catalog key, or punctuation", () => {
    const root = { FVTTWORLDCLI: { N: { Closed: "Closed ({code}): {reason}", None: "no reason" } } };

    expect(
      findPlaceholderMismatches(
        [
          'format("FVTTWORLDCLI.N.Closed", {',
          "  code: `${event.code}:${event.type}`,",
          '  reason: event.reason || localize("FVTTWORLDCLI.N.None")',
          "})"
        ].join("\n"),
        root
      )
    ).toEqual([]);
  });

  it("reports a format call whose key or data it cannot read", () => {
    expect(findPlaceholderMismatches("format(key, data)", {})).toEqual([
      "unreadable format contract: format(key, data)"
    ]);
  });

  it("follows a key map to the placeholders of every key it can select", () => {
    const source = [
      'const ACTION_KEYS = Object.freeze({ pair: "FVTTWORLDCLI.N.Pair", connect: "FVTTWORLDCLI.N.Connect" });',
      "format(ACTION_KEYS[action], { error });"
    ].join("\n");
    const root = { FVTTWORLDCLI: { N: { Pair: "Pairing failed: {error}", Connect: "Connect failed" } } };

    expect(findPlaceholderMismatches(source, root)).toEqual([
      "FVTTWORLDCLI.N.Connect: supplies error, the catalog declares nothing"
    ]);
  });

  it("reports a placeholder string handed to localize instead of format", () => {
    const root = { FVTTWORLDCLI: { N: { Code: "Pairing code: {code}", Done: "Paired" } } };

    expect(
      findFormattedLocalizeCalls('localize("FVTTWORLDCLI.N.Code") + localize("FVTTWORLDCLI.N.Done")', root)
    ).toEqual(["FVTTWORLDCLI.N.Code"]);
  });

  it("follows a localized key through a map and a local name to every string it can select", () => {
    const source = [
      'const STATE_LABELS = Object.freeze({ pending: "FVTTWORLDCLI.N.Pending", offline: "FVTTWORLDCLI.N.Offline" });',
      'const RAW_DETAILS = Object.freeze({ idle: "FVTTWORLDCLI.N.Idle" });',
      "localize(STATE_LABELS[displayState]);",
      'const detailKey = rawStatus === "connected" ? "FVTTWORLDCLI.N.Awaiting" : RAW_DETAILS[rawStatus];',
      "localize(detailKey);"
    ].join("\n");
    const root = {
      FVTTWORLDCLI: {
        N: {
          Pending: "Connecting",
          Offline: "Offline ({attempt})",
          Idle: "Idle since {at}",
          Awaiting: "Awaiting handshake"
        }
      }
    };

    expect(findFormattedLocalizeCalls(source, root)).toEqual([
      "FVTTWORLDCLI.N.Offline",
      "FVTTWORLDCLI.N.Idle"
    ]);
  });

  it("reports a template row whose format data and string disagree", () => {
    const root = { FVTTWORLDCLI: { B: { StateDetail: "{state} ({detail})", Connection: "Connection" } } };
    const source = [
      '<label>{{localize "FVTTWORLDCLI.B.Connection"}}</label>',
      "<strong>{{localize",
      '  "FVTTWORLDCLI.B.StateDetail" state=displayState}}</strong>',
      "<span>{{localize connectionActionLabel}}</span>"
    ].join("\n");

    expect(findTemplatePlaceholderMismatches(source, root)).toEqual([
      "FVTTWORLDCLI.B.StateDetail: supplies state, the catalog declares state,detail"
    ]);
  });

  it("reports a template row that localizes a placeholder string with no format data at all", () => {
    const root = { FVTTWORLDCLI: { B: { StateDetail: "{state} ({detail})" } } };

    expect(
      findTemplatePlaceholderMismatches('<strong>{{localize "FVTTWORLDCLI.B.StateDetail"}}</strong>', root)
    ).toEqual(["FVTTWORLDCLI.B.StateDetail: supplies nothing, the catalog declares state,detail"]);
  });

  it("reports a template row whose hash splices readable text into the catalog's sentence", () => {
    const root = { FVTTWORLDCLI: { B: { StateDetail: "{state} ({detail})" } } };
    const source =
      '<strong>{{localize "FVTTWORLDCLI.B.StateDetail" state=displayState detail="Awaiting handshake"}}</strong>';

    expect(findTemplatePlaceholderMismatches(source, root)).toEqual([
      '{detail}: supplies readable text "Awaiting handshake"'
    ]);
  });

  it("accepts a template row that hands a placeholder string the hash Foundry formats with", () => {
    const root = { FVTTWORLDCLI: { B: { StateDetail: "{state} ({detail})", Connection: "Connection" } } };
    const source = [
      '<label>{{localize "FVTTWORLDCLI.B.Connection"}}</label>',
      '<strong>{{localize "FVTTWORLDCLI.B.StateDetail" state=displayState detail=url}}</strong>'
    ].join("\n");

    expect(findTemplatePlaceholderMismatches(source, root)).toEqual([]);
  });

  it("reports readable text a template writes outside a mustache", () => {
    expect(findTemplateTextNodes("<p>Only a GM can manage authorization.</p>")).toEqual([
      "Only a GM can manage authorization."
    ]);
    expect(
      findTemplateTextNodes(
        '<div class="a-{{state}}">{{#if url}}{{url}}{{else}}&mdash;{{/if}}{{! note }}</div>'
      )
    ).toEqual([]);
    expect(findTemplateTextNodes("<p>{{{content}}}</p>")).toEqual([]);
  });

  it("reports readable text a template writes into an attribute", () => {
    expect(
      findTemplateAttributeTexts('<input data-tooltip="Fixed after pairing; unpair to change" />')
    ).toEqual(["Fixed after pairing; unpair to change"]);
    expect(findTemplateAttributeTexts("<img alt='The bridge status glyph' />")).toEqual([
      "The bridge status glyph"
    ]);
  });

  it("accepts a template attribute whose text the localize helper renders", () => {
    expect(
      findTemplateAttributeTexts(
        '<input name="clientLabel" value="{{clientLabel}}" data-tooltip="{{localize clientLabelTooltip}}" />'
      )
    ).toEqual([]);
  });

  it("follows a context row's key to every catalog string the scripts can select", () => {
    const sources = [
      {
        path: "scripts/lib/a.js",
        source: 'const ACTION_LABELS = Object.freeze({ connect: "FVTTWORLDCLI.N.Connect" });'
      },
      {
        path: "scripts/b.js",
        source: [
          "return {",
          '  tooltip: editable ? "FVTTWORLDCLI.N.Editable" : "FVTTWORLDCLI.N.Fixed",',
          '  actionLabel: action ? ACTION_LABELS[action] : ""',
          "};"
        ].join("\n")
      }
    ];
    const root = {
      FVTTWORLDCLI: { N: { Editable: "Edit it", Fixed: "{label}: fixed", Connect: "Connect" } }
    };

    expect(
      findTemplateContextRowMismatches("{{localize tooltip}}{{localize actionLabel}}", sources, root)
    ).toEqual(["FVTTWORLDCLI.N.Fixed: declares label, a context row can supply nothing"]);
  });

  it("reports a context row whose field selects readable text alongside a catalog key", () => {
    const sources = [
      {
        path: "scripts/authorization.js",
        source: 'clientLabelNote: paired ? "FVTTWORLDCLI.N.Fixed" : "Pair to name this browser.",'
      }
    ];
    const root = { FVTTWORLDCLI: { N: { Fixed: "Fixed after pairing" } } };

    expect(findTemplateContextRowMismatches("{{localize clientLabelNote}}", sources, root)).toEqual([
      'clientLabelNote: binds readable text "Pair to name this browser."'
    ]);
  });

  it("reports a context row whose key no script binds", () => {
    expect(findTemplateContextRowMismatches("{{localize mysteryLabel}}", [], {})).toEqual([
      "unreadable context key: mysteryLabel"
    ]);
  });

  it("reports an option value written as readable text instead of a catalog key", () => {
    expect(
      findUnlocalizedOptionTexts('const tool = { name: "reconnect", title: "Reconnect the bridge now" };')
    ).toEqual(['title: "Reconnect the bridge now"']);
    expect(
      findUnlocalizedOptionTexts(
        'game.settings.register(MODULE_ID, "pruneDays", { name: "Prune after", config: true });'
      )
    ).toEqual(['name: "Prune after"']);
  });

  it("reports an option value written in a spelling other than double quotes", () => {
    const source = [
      "const tool = {",
      '  name: "reconnect",',
      "  title: `${MODULE_TITLE} status`,",
      "  hint: 'Reconnect the bridge now'",
      "};"
    ].join("\n");

    expect(findUnlocalizedOptionTexts(source)).toEqual([
      "title: `${MODULE_TITLE} status`",
      "hint: 'Reconnect the bridge now'"
    ]);
  });

  it("reports the option text of a file that names no catalog key at all", () => {
    const source = [
      'window: { title: "World CLI Prune" },',
      'game.settings.register(MODULE_ID, "pruneDays", {',
      '  name: "Prune after",',
      '  hint: "Days before an idle pairing is dropped."',
      "});"
    ].join("\n");

    expect(findUnlocalizedOptionTexts(source)).toEqual([
      'title: "World CLI Prune"',
      'hint: "Days before an idle pairing is dropped."',
      'name: "Prune after"'
    ]);
  });

  it("reports a settings menu whose button label is written as readable text", () => {
    expect(
      findUnlocalizedOptionTexts(
        'game.settings.registerMenu(MODULE_ID, "authorization", { label: "Manage Authorization" });'
      )
    ).toEqual(['label: "Manage Authorization"']);
    expect(findUnlocalizedLabelOptions('const menu = { label: "Manage Authorization" };')).toEqual([
      'label: "Manage Authorization"'
    ]);
  });

  it("leaves an internal field named label to the handler code that declares it", () => {
    expect(findUnlocalizedOptionTexts('createWorldDocumentBatchHandlers({ label: "actor" })')).toEqual([]);
  });

  it("accepts an option value taken from the catalog or supplied by world data", () => {
    const source = [
      'window: { title: "FVTTWORLDCLI.Authorization.Title" },',
      'world: { id: game.world.id, title: game.world?.title ?? "Unknown World" },',
      'game.settings.registerMenu(MODULE_ID, "authorization", { name: "FVTTWORLDCLI.Settings.AuthorizationName" });'
    ].join("\n");

    expect(findUnlocalizedOptionTexts(source)).toEqual([]);
  });

  it("reports a warning builder that never reaches the catalog", () => {
    const source = [
      "export function getBridgeBusyWarningMessage() {",
      "  return `${MODULE_TITLE} stopped: the slot is busy.`;",
      "}",
      "",
      "export function getRejectedCredentialWarningMessage() {",
      '  return format("FVTTWORLDCLI.Startup.RejectedCredential", { module: MODULE_TITLE });',
      "}"
    ].join("\n");

    expect(findUnlocalizedWarningBuilders(source)).toEqual(["getBridgeBusyWarningMessage"]);
  });

  it("reports a warning builder that appends raw text to a localized sentence", () => {
    const source = [
      "export function getBridgeBusyWarningMessage(slot) {",
      '  return format("FVTTWORLDCLI.Startup.BridgeBusy", { module: MODULE_TITLE }) + ` Slot: ${slot}.`;',
      "}"
    ].join("\n");

    expect(findUnlocalizedWarningBuilders(source)).toEqual(["getBridgeBusyWarningMessage"]);
  });

  it("reports a warning builder in whichever declaration form a call site can trust", () => {
    const source = [
      "function getDisconnectedWarningMessage() {",
      '  return "The bridge was disconnected from the toolbar.";',
      "}",
      "",
      "export const getReleasedWarningMessage = () => `${MODULE_TITLE} released the bridge slot.`;",
      "",
      "const getPrunedWarningMessage = () =>",
      '  format("FVTTWORLDCLI.Startup.Pruned", { module: MODULE_TITLE });'
    ].join("\n");

    expect(findUnlocalizedWarningBuilders(source)).toEqual([
      "getDisconnectedWarningMessage",
      "getReleasedWarningMessage"
    ]);
  });

  it("names the builders a source declares beside the ones its call sites trust", () => {
    const declarations = [
      "export function getNotPairedWarningMessage() {",
      '  return localize("FVTTWORLDCLI.Startup.NotPaired");',
      "}"
    ].join("\n");

    expect(findWarningBuilders(declarations).map(({ name }) => name)).toEqual(["getNotPairedWarningMessage"]);
    expect(findWarningBuilders("notifications.warn(getNotPairedWarningMessage());")).toEqual([]);
    expect(findWarningBuilderCalls("notifications.warn(getReleasedWarningMessage(), {});")).toEqual([
      "getReleasedWarningMessage"
    ]);
    expect(findWarningBuilderCalls("notifications.warn(this.getReleasedWarningMessage());")).toEqual([]);
  });

  it("accepts a warning builder whose every conditional branch is one catalog call", () => {
    const source = [
      "export function getRejectedHandshakeWarningMessage(reason) {",
      "  return reason",
      '    ? format("FVTTWORLDCLI.Startup.RejectedHandshakeWithReason", { module: MODULE_TITLE, reason })',
      '    : format("FVTTWORLDCLI.Startup.RejectedHandshake", { module: MODULE_TITLE });',
      "}"
    ].join("\n");

    expect(findUnlocalizedWarningBuilders(source)).toEqual([]);
  });
});
