import { join } from "node:path";

import {
  AUDIT_FILE_SCOPES,
  REFERENCE_DEFAULT_SCOPES,
  REFERENCE_SCOPES,
  SEARCH_INDEXED_TYPES,
  SEARCH_MODES,
  SEARCH_SOURCES
} from "@fvtt-world-cli/protocol";
import { Option } from "commander";

import { executeRemoteCommand } from "../exec.js";
import { parseScopeList, parseSearchTypeList } from "../parse.js";
import { type RegistrationContext, addPaginationOptions, paginationParams } from "./shared.js";

interface WorldReferencesOptions {
  uuid: string;
  scope?: string[];
  limit?: number;
  offset?: number;
}

export function registerWorld({ program, dependencies }: RegistrationContext) {
  const world = program.command("world").description("Foundry world-wide maintenance commands");
  world.addHelpText(
    "after",
    [
      "",
      "Result key (--json): .result.broken[] (+ .result.checkedRefs / .result.checkedFiles / .result.skipped[], total/hasMore over broken) for audit-files.",
      "Result key (--json): .result.results[] (+ .result.total / .result.hasMore / .result.index) for search.",
      "Result key (--json): .result.references[] (+ .result.target / .result.total / .result.hasMore / .result.scannedDocuments / .result.selfReferences / .result.scopes) for references.",
      "",
      "search: results are SECTIONED — world rows first, then pack rows, each ranked among itself.",
      "`score` is comparable only WITHIN a section (the two corpora are separate indexes), so compare",
      "ORDER, never magnitudes across the boundary; .result.index.<corpus>.matchCount locates it.",
      "The index is built on the first search and rebuilt after any change to an indexed field, so the",
      "first search of a session is the slow one. `--mode name` searches stored NAMES; `--mode full`",
      "adds journal/description body text and the Actor/Item `system` walk, and returns a plain-text",
      "`snippet` with UTF-16 match offsets (never <mark> HTML). Compendium rows stay NAME-ONLY in both",
      "modes and their snippet is always null. Only the STORED value is indexed:",
      "a document is not findable by a name Foundry derives for display.",
      "A resolved:false row names a document deleted since the index was built — do not feed its id",
      "to a follow-up get/update verb."
    ].join("\n")
  );
  addPaginationOptions(
    world
      .command("audit-files")
      .description("Report document references pointing at files missing from the data source")
      .option(
        "--scope <list>",

        `Comma-separated subset to audit: ${AUDIT_FILE_SCOPES.join(",")} (default: all)`,
        parseScopeList
      )
  ).action(async function auditFiles(options: { scope?: string[]; limit?: number; offset?: number }) {
    await executeRemoteCommand({
      commandName: "world.audit-files",
      params: {
        ...(options.scope ? { scope: options.scope } : {}),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });

  addPaginationOptions(
    world
      .command("references")
      .description("Report where stored world data references a document, by its UUID")
      .requiredOption(
        "--uuid <uuid>",
        "Target document UUID: Actor.<id>, Scene.<id>.Token.<id>, Compendium.<package>.<pack>.<Type>.<id>, …"
      )
      .option(
        "--scope <list>",
        `Comma-separated document families to scan: ${REFERENCE_SCOPES.join(",")} (default: ${REFERENCE_DEFAULT_SCOPES.join(",")}; chat only on request)`,
        parseScopeList
      )
      .addHelpText(
        "after",
        [
          "",
          "Scans the stored data, flags and _stats included, of every world document in scope, its embedded",
          "documents, and every user. Each row names the owning document by UUID and the dotted field path in it;",
          "a match inside a token's delta is reported on the token (field delta.…). An embedded target needs its",
          "full UUID (Scene.<s>.Token.<t>).",
          "match: uuid      a field holds the target UUID",
          "       link      an @UUID[...] link or a legacy @Actor[<id>] / @Compendium[<pack>.<id>] link names the target",
          "       embedded  a field holds the UUID of a document embedded in the target (matchedUuid); deleting the",
          "                 target breaks it too",
          "       key       an object key names the target; a dotted key Foundry stored nested is reported at the",
          "                 target's id (flags.mod.Actor.<id>)",
          "       relative  a relative link (@UUID[.<id>], @Embed[.<id>]) in journal page text or a roll table or",
          "                 table result description resolves to the target or a document in it (matchedUuid)",
          "       id        a foreign-key field of the target's type (token actorId, note entryId, folder, setting user,",
          "                 chat speaker, …) or a hotbar slot (hotbar.<slot>) holds the target's id; for an embedded",
          "                 target only where the record also names its parent or sits inside it, and never for a",
          "                 deeper target such as a token's actor",
          "setting: world and user settings, read as stored JSON (rows Setting.<id>, name = key, field value[.<path>]).",
          "Not found: compendium contents, client settings, bare ids outside foreign-key fields (system data, object",
          "keys, chat whisper lists) or in fields Foundry maintains itself (_stats.lastModifiedBy), name-based links",
          "(@Actor[Goblin]), relative links in other fields. References inside the target itself are counted in",
          "selfReferences."
        ].join("\n")
      )
  ).action(async function findReferences(options: WorldReferencesOptions) {
    await executeRemoteCommand({
      commandName: "world.references",
      params: {
        uuid: options.uuid,
        ...(options.scope ? { scope: options.scope } : {}),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });

  addPaginationOptions(
    world
      .command("search")
      .description("Search world (and optionally compendium) documents through the bridge index")
      .requiredOption("--query <query>", "Search query (2-256 characters; terms are AND-combined)")
      .addOption(
        new Option(
          "--mode <mode>",

          'Fields to search: "name" (stored names only) or "full" (names + body text + the Actor/Item system walk, with snippets)'
        )
          .choices([...SEARCH_MODES])
          .default(SEARCH_MODES[0])
      )
      .option(
        "--types <list>",

        `Comma-separated document types to search: ${SEARCH_INDEXED_TYPES.join(",")} (default: all)`,
        parseSearchTypeList
      )
      .option("--include-compendia", "Also search compendium pack entry NAMES (off by default)")
      .addOption(
        new Option(
          "--source <source>",
          'Return only one section: "world", or "pack" (which requires --include-compendia)'
        ).choices([...SEARCH_SOURCES])
      )
  ).action(async function searchWorld(options: {
    query: string;
    mode?: string;
    types?: string[];
    includeCompendia?: boolean;
    source?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "world.search",
      params: {
        query: options.query,
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.types && options.types.length ? { types: options.types } : {}),
        ...(options.includeCompendia ? { includeCompendia: true } : {}),
        ...(options.source ? { source: options.source } : {}),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
}
