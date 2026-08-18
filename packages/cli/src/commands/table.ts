import { TABLE_ROLL_MODES } from "@fvtt-world-cli/protocol";
import { Option } from "commander";

import {
  createTableCloneParams,
  createTableCreateParams,
  createTableResultCloneParams,
  createTableResultCreateParams,
  createTableResultUpdateParams,
  createTableUpdateParams,
  type TableFieldOptions,
  type TableResultFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseIdList, parsePositiveInt, parseResultRange } from "../parse.js";
import { addTableFieldOptions, addTableResultFieldOptions } from "./field-options.js";
import {
  type RegistrationContext,
  createSharedRegistrars,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";

export function registerTable({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport } = createSharedRegistrars(dependencies);
  const table = program.command("table").description("Foundry roll table commands");

  const TABLE_RESULT_KEY_HELP =
    "rows at .result.result / .result.results[] (+ .result.tableId; rows also ride inside .result.table.results[] on a table read)";

  table.addHelpText(
    "after",
    `\nResult key (--json): .result.table / .result.tables[] (list, get-many); ${TABLE_RESULT_KEY_HELP}.` +
      "\nAction verbs differ: `table draw` has NO .result.table — read .result.results[] (the drawn rows," +
      " each carrying its own owning tableId) plus .result.complete/.mutation/.roll/.availableBefore/" +
      ".availableAfter/.chatMessages (and .failure on a partial commit); `table reset` returns" +
      " .result.table plus .result.tableId/.reset/.changedCount."
  );
  registerOwnershipSet(table, {
    idFlag: "--table-id <tableId>",
    idKey: "tableId",
    commandName: "table.ownership.set",
    noun: "table"
  });
  addNameFilterOption(addPaginationOptions(table.command("list"))).action(async function listTables(options: {
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "table.list",
      params: { ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  table
    .command("get")
    .requiredOption("--table-id <tableId>", "Roll table id")
    .action(async function getTable(options: { tableId: string }) {
      await executeRemoteCommand({
        commandName: "table.get",
        params: { tableId: options.tableId },
        command: this,
        dependencies
      });
    });
  table
    .command("get-many")
    .requiredOption("--ids <list>", "Comma-separated roll table ids (atomic: all must exist)", parseIdList)
    .action(async function getManyTables(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "table.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  addTableFieldOptions(
    addIdempotencyKeyOption(table.command("create")).requiredOption("--name <name>", "Roll table name"),
    "create"
  )
    .option(
      "--results-json <json>",
      'Inline results as a JSON array; each entry REQUIRES `range` ([low, high]), e.g. [{"name":"Sword","range":[1,3]}]'
    )
    .option("--data-json <json>", "Extra table fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createTableCommand(
      options: TableFieldOptions & { name: string; resultsJson?: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "table.create",
        params: createTableCreateParams(options),
        command: this,
        dependencies
      });
    });
  addTableFieldOptions(
    table
      .command("update")
      .requiredOption("--table-id <tableId>", "Roll table id")
      .option("--name <name>", "New table name"),
    "update"
  )
    .option("--patch-json <json>", "Extra table patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateTableCommand(
      options: TableFieldOptions & { tableId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "table.update",
        params: createTableUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addTableFieldOptions(
    addIdempotencyKeyOption(table.command("clone"))
      .requiredOption("--table-id <tableId>", "Source roll table id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneTableCommand(
      options: TableFieldOptions & { tableId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "table.clone",
        params: createTableCloneParams(options),
        command: this,
        dependencies
      });
    });
  table
    .command("delete")
    .requiredOption("--table-id <tableId>", "Roll table id")
    .action(async function deleteTable(options: { tableId: string }) {
      await executeRemoteCommand({
        commandName: "table.delete",
        params: { tableId: options.tableId },
        command: this,
        dependencies
      });
    });

  table
    .command("draw")
    .description("Draw one or more results from a roll table (Foundry's own RollTable#draw)")
    .requiredOption("--table-id <tableId>", "Roll table id")
    .requiredOption(
      "--idempotency-key <key>",
      "REQUIRED: client-supplied key so a retried draw returns the original result instead of drawing again. Reuse the SAME key across retries of one draw."
    )
    .addOption(
      new Option(
        "--count <n>",
        "Number of draw ITERATIONS, max 100 (>1 uses RollTable#drawMany); each iteration can return several rows, so results are not capped at this number"
      ).argParser(parsePositiveInt)
    )
    .addOption(
      new Option(
        "--roll-mode <mode>",
        "Chat visibility of the draw message (translated per Foundry version; default public)"
      ).choices([...TABLE_ROLL_MODES])
    )
    .option("--no-chat", "Do not post Foundry's draw message to chat")
    .option("--no-recursive", "Do not roll into nested roll-table results")
    .action(async function drawFromTableCommand(options: {
      tableId: string;
      count?: number;
      rollMode?: string;
      chat: boolean;
      recursive: boolean;
    }) {
      await executeRemoteCommand({
        commandName: "table.draw",
        params: {
          tableId: options.tableId,
          ...(options.count !== undefined ? { count: options.count } : {}),
          ...(options.rollMode !== undefined ? { rollMode: options.rollMode } : {}),

          ...(options.chat === false ? { chat: false } : {}),
          ...(options.recursive === false ? { recursive: false } : {})
        },
        command: this,
        dependencies
      });
    });

  addIdempotencyKeyOption(table.command("reset"))
    .description("Clear the `drawn` flag on every result of a roll table")
    .requiredOption("--table-id <tableId>", "Roll table id")
    .action(async function resetTableCommand(options: { tableId: string }) {
      await executeRemoteCommand({
        commandName: "table.reset",
        params: { tableId: options.tableId },
        command: this,
        dependencies
      });
    });

  const tableResult = table.command("result").description("Roll-table row (result) commands");
  tableResult.addHelpText("after", `\nResult key (--json): ${TABLE_RESULT_KEY_HELP}.`);
  addNameFilterOption(
    addPaginationOptions(
      tableResult
        .command("list")
        // --table-id is OPTIONAL: omit it to list rows across ALL roll tables.
        .option("--table-id <tableId>", "Roll table id (omit to list across all roll tables)")
    )
  ).action(async function listTableResults(options: {
    tableId?: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "table.result.list",
      params: {
        ...(options.tableId !== undefined ? { tableId: options.tableId } : {}),
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  tableResult
    .command("get")
    .requiredOption("--table-id <tableId>", "Roll table id")
    .requiredOption("--result-id <resultId>", "Result (row) id")
    .action(async function getTableResult(options: { tableId: string; resultId: string }) {
      await executeRemoteCommand({
        commandName: "table.result.get",
        params: { tableId: options.tableId, resultId: options.resultId },
        command: this,
        dependencies
      });
    });
  addTableResultFieldOptions(
    addIdempotencyKeyOption(tableResult.command("create"))
      .requiredOption("--table-id <tableId>", "Roll table id")
      .requiredOption(
        "--range <low,high>",
        "REQUIRED two-integer ASCENDING roll range, e.g. 1,3 (a single-value row uses the same number twice: 3,3)",
        parseResultRange
      ),
    "create"
  )
    .option("--data-json <json>", "Extra row fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createTableResultCommand(
      options: TableResultFieldOptions & { tableId: string; range: number[]; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "table.result.create",
        params: createTableResultCreateParams(options),
        command: this,
        dependencies
      });
    });
  addTableResultFieldOptions(
    tableResult
      .command("update")
      .requiredOption("--table-id <tableId>", "Roll table id")
      .requiredOption("--result-id <resultId>", "Result (row) id")
      .addOption(
        new Option("--range <low,high>", "New two-integer ascending roll range, e.g. 1,3").argParser(
          parseResultRange
        )
      ),
    "update"
  )
    .option("--patch-json <json>", "Extra row patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateTableResultCommand(
      options: TableResultFieldOptions & { tableId: string; resultId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "table.result.update",
        params: createTableResultUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addTableResultFieldOptions(
    addIdempotencyKeyOption(tableResult.command("clone"))
      .requiredOption("--table-id <tableId>", "Roll table id")
      .requiredOption("--result-id <resultId>", "Source result (row) id")
      .addOption(
        new Option("--range <low,high>", "Range override (two ascending integers), e.g. 4,6").argParser(
          parseResultRange
        )
      ),
    "clone"
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneTableResultCommand(
      options: TableResultFieldOptions & { tableId: string; resultId: string; patchJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "table.result.clone",
        params: createTableResultCloneParams(options),
        command: this,
        dependencies
      });
    });
  tableResult
    .command("delete")
    .requiredOption("--table-id <tableId>", "Roll table id")
    .requiredOption("--result-id <resultId>", "Result (row) id")
    .action(async function deleteTableResult(options: { tableId: string; resultId: string }) {
      await executeRemoteCommand({
        commandName: "table.result.delete",
        params: { tableId: options.tableId, resultId: options.resultId },
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(table, {
    commandName: "table.import-from-compendium",
    noun: "roll table",
    packExample: "dnd5e.tables"
  });
}
