import { Option } from "commander";

import {
  createJournalCategoryCreateParams,
  createJournalCategoryUpdateParams,
  createJournalCloneParams,
  createJournalCreateParams,
  createJournalUpdateParams,
  type JournalCategoryFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseCsvList, parseIdList } from "../parse.js";
import {
  JOURNAL_CATEGORY_NAME_HELP,
  addJournalCategoryFieldOptions,
  addJournalFieldOptions
} from "./field-options.js";
import {
  type RegistrationContext,
  createSharedRegistrars,
  addIdempotencyKeyOption,
  addNameFilterOption,
  addPaginationOptions,
  nameFilterParams,
  paginationParams
} from "./shared.js";
import { write } from "../deps.js";

export function registerJournal({ program, dependencies }: RegistrationContext) {
  const { registerOwnershipSet, registerCompendiumImport, registerBatchWriteCommands } =
    createSharedRegistrars(dependencies);
  const journal = program.command("journal").description("Foundry journal commands");
  journal.addHelpText(
    "after",
    "\nResult key (--json): .result.journal (single/write; pages at .result.journal.pages[]) / .result.journals[] (list)."
  );

  registerBatchWriteCommands(journal, {
    prefix: "journal",
    noun: "journal",
    scope: "world",
    verbs: ["update-many", "delete-many"]
  });
  registerOwnershipSet(journal, {
    idFlag: "--journal-id <journalId>",
    idKey: "journalId",
    commandName: "journal.ownership.set",
    noun: "journal",
    withPageId: true
  });
  addNameFilterOption(addPaginationOptions(journal.command("list"))).action(
    async function listJournals(options: { name?: string; limit?: number; offset?: number }) {
      await executeRemoteCommand({
        commandName: "journal.list",
        params: { ...nameFilterParams(options), ...paginationParams(options) },
        command: this,
        dependencies
      });
    }
  );
  journal
    .command("get")
    .requiredOption("--journal-id <journalId>", "Journal id")
    .action(async function getJournal(options: { journalId: string }) {
      await executeRemoteCommand({
        commandName: "journal.get",
        params: { journalId: options.journalId },
        command: this,
        dependencies
      });
    });
  journal
    .command("get-many")
    .requiredOption("--ids <list>", "Comma-separated journal ids (atomic: all must exist)", parseIdList)
    .action(async function getManyJournals(options: { ids: string[] }) {
      await executeRemoteCommand({
        commandName: "journal.get-many",
        params: { ids: options.ids },
        command: this,
        dependencies
      });
    });
  addJournalFieldOptions(
    addIdempotencyKeyOption(journal.command("create")).requiredOption("--name <name>", "Journal name"),
    "create"
  )
    .option(
      "--pages-json <json>",
      "Journal pages as a JSON array; each page accepts name/type/sort/src/category/system/flags plus text(content,markdown,format)/title(show,level)/image.caption/video — see `fvtt-world-cli schema journal.create`"
    )
    .option("--data-json <json>", "Extra journal fields (e.g. flags) as a JSON object (merged last)")
    .action(async function createJournal(options: {
      name: string;
      folder?: string;
      clearFolder?: boolean;
      sort?: number;
      pagesJson?: string;
      dataJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "journal.create",
        params: createJournalCreateParams(options),
        command: this,
        dependencies
      });
    });
  addJournalFieldOptions(
    journal
      .command("update")
      .requiredOption("--journal-id <journalId>", "Journal id")
      .option("--name <name>", "New journal name"),
    "update"
  )
    .option(
      "--pages-json <json>",
      "Journal page patches as a JSON array; entries with `id` update, without create; each accepts name/type/sort/src/category/system/flags plus text(content,markdown,format)/title(show,level)/image.caption/video — see `fvtt-world-cli schema journal.update`"
    )
    .addOption(
      new Option("--delete-page-ids <ids>", "Comma-separated journal page ids to delete").argParser((value) =>
        parseCsvList(value, "--delete-page-ids")
      )
    )
    .option("--patch-json <json>", "Extra journal patch fields (e.g. flags) as a JSON object (merged last)")
    .action(async function updateJournal(options: {
      journalId: string;
      name?: string;
      folder?: string;
      clearFolder?: boolean;
      sort?: number;
      pagesJson?: string;
      deletePageIds?: string[];
      patchJson?: string;
    }) {
      await executeRemoteCommand({
        commandName: "journal.update",
        params: createJournalUpdateParams(options),
        command: this,
        dependencies
      });
    });
  addJournalFieldOptions(
    addIdempotencyKeyOption(journal.command("clone"))
      .requiredOption("--journal-id <journalId>", "Source journal id")
      .option("--name <name>", "Name override for the clone"),
    "clone"
  ).action(async function cloneJournal(options: {
    journalId: string;
    name?: string;
    folder?: string;
    clearFolder?: boolean;
    sort?: number;
  }) {
    await executeRemoteCommand({
      commandName: "journal.clone",
      params: createJournalCloneParams(options),
      command: this,
      dependencies
    });
  });
  journal
    .command("delete")
    .requiredOption("--journal-id <journalId>", "Journal id")
    .action(async function deleteJournal(options: { journalId: string }) {
      await executeRemoteCommand({
        commandName: "journal.delete",
        params: { journalId: options.journalId },
        command: this,
        dependencies
      });
    });

  const journalCategory = journal
    .command("category")
    .description("Journal-embedded category commands (labels pages are grouped under)");
  journalCategory.addHelpText(
    "after",
    "\nResult key (--json): .result.category (single/write) / .result.categories[] (list), with .result.journalId alongside." +
      '\nA category name may legitimately be BLANK (Foundry allows it): pass --name "" to author one; the CLI prints it as (blank).' +
      '\nSet a page\'s category with: journal update --journal-id <id> --pages-json \'[{"id":"<pageId>","category":"<categoryId>"}]\'' +
      "\ndelete does NOT re-point pages (Foundry rewrites nothing either); it reports how many pages of this journal are left referencing the id, which Foundry then renders as uncategorized."
  );
  addNameFilterOption(
    addPaginationOptions(
      journalCategory.command("list").requiredOption("--journal-id <journalId>", "Journal id")
    )
  ).action(async function listJournalCategories(options: {
    journalId: string;
    name?: string;
    limit?: number;
    offset?: number;
  }) {
    await executeRemoteCommand({
      commandName: "journal.category.list",
      params: {
        journalId: options.journalId,
        ...nameFilterParams(options),
        ...paginationParams(options)
      },
      command: this,
      dependencies
    });
  });
  journalCategory
    .command("get")
    .requiredOption("--journal-id <journalId>", "Journal id")
    .requiredOption("--category-id <categoryId>", "Category id")
    .action(async function getJournalCategory(options: { journalId: string; categoryId: string }) {
      await executeRemoteCommand({
        commandName: "journal.category.get",
        params: { journalId: options.journalId, categoryId: options.categoryId },
        command: this,
        dependencies
      });
    });
  addJournalCategoryFieldOptions(
    addIdempotencyKeyOption(journalCategory.command("create"))
      .requiredOption("--journal-id <journalId>", "Journal id")
      // REQUIRED but BLANK-ALLOWED: Foundry itself accepts an omitted name and stores "", so requiring
      // the flag is bridge policy — it makes an unnamed category an explicit `--name ""`.
      .requiredOption("--name <name>", JOURNAL_CATEGORY_NAME_HELP),
    "create"
  )
    .option("--data-json <json>", "Full/extra category data as a JSON object (merged last)")
    .action(async function createJournalCategoryCommand(
      options: JournalCategoryFieldOptions & { journalId: string; name: string; dataJson?: string }
    ) {
      await executeRemoteCommand({
        commandName: "journal.category.create",
        params: createJournalCategoryCreateParams(options),
        command: this,
        dependencies
      });
    });
  addJournalCategoryFieldOptions(
    journalCategory
      .command("update")
      .requiredOption("--journal-id <journalId>", "Journal id")
      .requiredOption("--category-id <categoryId>", "Category id"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra category patch as a JSON object (merged last)")
    .action(async function updateJournalCategoryCommand(
      options: JournalCategoryFieldOptions & {
        journalId: string;
        categoryId: string;
        patchJson?: string;
      }
    ) {
      await executeRemoteCommand({
        commandName: "journal.category.update",
        params: createJournalCategoryUpdateParams(options),
        command: this,
        dependencies
      });
    });
  journalCategory
    .command("delete")
    .requiredOption("--journal-id <journalId>", "Journal id")
    .requiredOption("--category-id <categoryId>", "Category id")
    .action(async function deleteJournalCategory(options: { journalId: string; categoryId: string }) {
      await executeRemoteCommand({
        commandName: "journal.category.delete",
        params: { journalId: options.journalId, categoryId: options.categoryId },
        command: this,
        dependencies
      });
    });

  registerCompendiumImport(journal, {
    commandName: "journal.import-from-compendium",
    noun: "journal entry",
    packExample: "dnd5e.rules"
  });
}
