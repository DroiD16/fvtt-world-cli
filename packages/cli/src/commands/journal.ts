import { Option } from "commander";

import {
  createJournalCategoryCreateParams,
  createJournalCategoryUpdateParams,
  createJournalPageCreateParams,
  createJournalPageUpdateParams,
  createJournalCloneParams,
  createJournalCreateParams,
  createJournalUpdateParams,
  booleanField,
  type JournalCategoryFieldOptions,
  type JournalPageFieldOptions
} from "../params.js";
import { executeRemoteCommand } from "../exec.js";
import { parseBoolean, parseCsvList, parseIdList } from "../parse.js";
import {
  JOURNAL_CATEGORY_NAME_HELP,
  addJournalCategoryFieldOptions,
  addJournalFieldOptions,
  addJournalPageFieldOptions
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

interface JournalPageListOptions {
  journalId: string;
  name?: string;
  limit?: number;
  offset?: number;
}

interface JournalPageTargetOptions {
  journalId: string;
  pageId: string;
}

interface JournalPageCreateOptions extends JournalPageFieldOptions {
  journalId: string;
  name: string;
  type: string;
  dataJson?: string;
}

interface JournalPageUpdateOptions extends JournalPageFieldOptions, JournalPageTargetOptions {
  patchJson?: string;
}

interface JournalCloneOptions {
  journalId: string;
  name?: string;
  folder?: string;
  clearFolder?: boolean;
  sort?: number;
  patchJson?: string;
}

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
  )
    .option("--patch-json <json>", "Override fields for the clone as a JSON object (merged last)")
    .action(async function cloneJournal(options: JournalCloneOptions) {
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

  const journalPage = journal
    .command("page")
    .description("Journal-embedded page commands (one page at a time; journal update batches several)");
  journalPage.addHelpText(
    "after",
    "\nResult key (--json): .result.page (single/write) / .result.pages[] (list), with .result.journalId alongside." +
      "\nlist returns summaries without text, system or flags; each carries textFormat, the stored text.format (1 HTML, 2 Markdown; null on image, pdf and video pages). get returns the full page with its ownership." +
      "\nPage data follows the journal.update page rules: text fields only on text pages, src only on image/pdf/video pages," +
      " image.caption only on image pages; see `fvtt-world-cli schema journal.page.create`." +
      '\nText content goes through --data-json/--patch-json, e.g. --patch-json \'{"text":{"content":"<p>…</p>"}}\'.' +
      "\nPage ownership: journal ownership set --journal-id <id> --page-id <pageId>."
  );
  addNameFilterOption(
    addPaginationOptions(journalPage.command("list").requiredOption("--journal-id <journalId>", "Journal id"))
  ).action(async function listJournalPages(options: JournalPageListOptions) {
    await executeRemoteCommand({
      commandName: "journal.page.list",
      params: { journalId: options.journalId, ...nameFilterParams(options), ...paginationParams(options) },
      command: this,
      dependencies
    });
  });
  journalPage
    .command("get")
    .requiredOption("--journal-id <journalId>", "Journal id")
    .requiredOption("--page-id <pageId>", "Page id")
    .action(async function getJournalPage(options: JournalPageTargetOptions) {
      await executeRemoteCommand({
        commandName: "journal.page.get",
        params: { journalId: options.journalId, pageId: options.pageId },
        command: this,
        dependencies
      });
    });
  addJournalPageFieldOptions(
    addIdempotencyKeyOption(journalPage.command("create"))
      .requiredOption("--journal-id <journalId>", "Journal id")
      .requiredOption("--name <name>", "Page name")
      .requiredOption("--type <type>", "Page type (text, image, pdf, video, or a system page type)"),
    "create"
  )
    .option("--data-json <json>", "Full/extra page data as a JSON object (merged last)")
    .action(async function createJournalPage(options: JournalPageCreateOptions) {
      await executeRemoteCommand({
        commandName: "journal.page.create",
        params: createJournalPageCreateParams(options),
        command: this,
        dependencies
      });
    });
  addJournalPageFieldOptions(
    journalPage
      .command("update")
      .requiredOption("--journal-id <journalId>", "Journal id")
      .requiredOption("--page-id <pageId>", "Page id")
      .option("--name <name>", "New page name")
      .option("--type <type>", "New page type"),
    "update"
  )
    .option("--patch-json <json>", "Full/extra page patch as a JSON object (merged last)")
    .action(async function updateJournalPage(options: JournalPageUpdateOptions) {
      await executeRemoteCommand({
        commandName: "journal.page.update",
        params: createJournalPageUpdateParams(options),
        command: this,
        dependencies
      });
    });
  journalPage
    .command("delete")
    .requiredOption("--journal-id <journalId>", "Journal id")
    .requiredOption("--page-id <pageId>", "Page id")
    .action(async function deleteJournalPage(options: JournalPageTargetOptions) {
      await executeRemoteCommand({
        commandName: "journal.page.delete",
        params: { journalId: options.journalId, pageId: options.pageId },
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

  journal
    .command("show")
    .description("Open a journal entry in other users' browsers (a broadcast, not a mutation)")
    .requiredOption("--journal-id <journalId>", "Journal entry id")
    .addOption(
      new Option(
        "--force <force>",
        "Push the entry even to users who cannot normally see it (true|false)"
      ).argParser(parseBoolean)
    )
    .option(
      "--user-ids <list>",
      "Comma-separated user ids to show it to (default: every user); offline users are reported as skipped",
      (value: string) => parseCsvList(value, "--user-ids")
    )
    .action(async function showJournal(options: { journalId: string; force?: boolean; userIds?: string[] }) {
      await executeRemoteCommand({
        commandName: "journal.show",
        params: {
          journalId: options.journalId,
          ...booleanField("force", options.force),
          ...(options.userIds ? { userIds: options.userIds } : {})
        },
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
