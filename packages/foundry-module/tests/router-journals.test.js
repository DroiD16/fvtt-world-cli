import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCommandRouter } from "../scripts/command-router.js";

import {
  createJournalCategoryDocument,
  createJournalDocument,
  createRequest,
  installFakeFoundry
} from "./helpers/fake-foundry.js";

describe("command router", () => {
  beforeEach(() => {
    installFakeFoundry();
  });

  it("lists, gets, creates, and updates journals", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const listResponse = await router.route(createRequest("journal.list"));
    const getResponse = await router.route(createRequest("journal.get", { journalId: "journal-1" }));
    const createResponse = await router.route(
      createRequest("journal.create", {
        data: {
          name: "Session Log",
          pages: [
            {
              name: "Entry 1",
              type: "text",
              text: {
                content: "Started the session"
              }
            }
          ]
        }
      })
    );
    const updateResponse = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: {
          name: "GM Notes Revised",
          pages: [
            {
              id: "page-1",
              text: {
                content: "Updated secret text"
              }
            },
            {
              name: "Clues",
              type: "text",
              text: {
                content: "Second page"
              }
            }
          ]
        }
      })
    );

    expect(listResponse.ok).toBe(true);

    expect(listResponse.result.journals).toHaveLength(4);
    expect(getResponse.ok).toBe(true);
    expect(getResponse.result.journal.pages[0].text.content).toBe("Secret text");
    expect(createResponse.ok).toBe(true);
    expect(globalThis.JournalEntry.create).toHaveBeenCalledWith(
      {
        name: "Session Log",
        pages: [
          {
            name: "Entry 1",
            type: "text",
            text: {
              content: "Started the session"
            }
          }
        ]
      },
      { render: true }
    );
    expect(updateResponse.ok).toBe(true);
    expect(updateResponse.result.journal.name).toBe("GM Notes Revised");
    expect(updateResponse.result.journal.pages).toHaveLength(2);
    expect(updateResponse.result.journal.pages[0].text.content).toBe("Updated secret text");
  });

  it("rejects journal.update with an empty pages array via module-side minItems validation", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: { pages: [] }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
  });

  it("rejects new journal pages that omit name and type with INVALID_PARAMS", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: {
          pages: [{ text: { content: "orphan page without name/type" } }]
        }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");

    expect(response.error.message).toBe("New journal pages (entries without an id) require name and type");
    expect(response.error.details.page).toEqual({ text: { content: "orphan page without name/type" } });

    expect(response.error.details.reason).toBeUndefined();
  });

  describe("type-aware journal page render guards", () => {
    const makeRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    async function updateGuard(patch) {
      return makeRouter().route(createRequest("journal.update", { journalId: "journal-guard", patch }));
    }

    it("rejects text.content on an image-type page, naming image.caption", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-image", text: { content: "nope" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image.caption");
    });

    it("rejects text.* on a video-type page, naming the video type", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-video", text: { content: "nope" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("video-type page");
    });

    it("rejects image.caption on a text-type page, naming image-type pages", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", image: { caption: "nope" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image-type pages");
    });

    it("rejects image.caption on a pdf-type page (caption renders only on image pages)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-pdf", image: { caption: "nope" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image-type pages");
    });

    it("rejects image.caption on a video-type page (caption renders only on image pages)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-video", image: { caption: "nope" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image-type pages");
    });

    it("rejects video settings on an image-type page (video renders only on video pages)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-image", video: { loop: true } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("video-type pages");
    });

    it("rejects video settings on a pdf-type page (video renders only on video pages)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-pdf", video: { autoplay: true } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("video-type pages");
    });

    it("rejects an explicit video.timestamp:null on a text-type page (authored, inert)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", video: { timestamp: null } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("video-type pages");
    });

    it("does NOT reject the default video {controls, volume} echo on a pdf page (round-trip safe)", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-pdf", video: { controls: true, volume: 0.5 } }]
      });
      expect(response.ok).toBe(true);
    });

    it("rejects a changed video.controls on a text-type page (inert cross-type change)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", video: { controls: false } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("video-type pages");
    });

    it("rejects a changed video.volume on a pdf-type page (inert cross-type change)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-pdf", video: { volume: 0.25 } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("video-type pages");
    });

    it("rejects a changed text.format on an image-type page (inert cross-type change)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-image", text: { format: 2 } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image-type page");
    });

    it("rejects text.content without text.markdown on a markdown (format 2) page", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-md", text: { content: "<p>x</p>" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.markdown");
    });

    it("rejects text.markdown on an HTML (format 1) page, naming text.content / format 2", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", text: { markdown: "# x" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.format 2");
    });

    it("rejects text.markdown sent together with text.content on an HTML (format 1) page", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-text", text: { content: "<p>body</p>", markdown: "# x" } }]
      });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.format 2");
    });

    it("rejects src on a text-type page (only image/pdf/video consume src)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", src: "worlds/w/art/x.webp" }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("src is not rendered");
    });

    it("does NOT reject src on an image-type page", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-image", src: "worlds/w/art/cover2.webp" }] });
      expect(response.ok).toBe(true);
    });

    it("does NOT reject src on a pdf-type page", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-pdf", src: "worlds/w/docs/h2.pdf" }] });
      expect(response.ok).toBe(true);
    });

    it("rejects an empty text.content clear-attempt on a markdown (format 2) page, naming text.markdown", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-md", text: { content: "" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.markdown");
    });

    it("rejects an empty text.content write on an image-type page, naming image.caption", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-image", text: { content: "" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image.caption");
    });

    it("rejects a text.content change sent together with text.markdown on a markdown page", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-md-derived", text: { markdown: "# H2", content: "<p>edited</p>" } }]
      });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.markdown");
    });

    it("accepts a verbatim echo of a markdown page's derived text.content (round-trip safe)", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-md-derived", text: { markdown: "# H", content: "<h1>H</h1>", format: 2 } }]
      });
      expect(response.ok).toBe(true);
    });

    it("rejects a one-step image->text conversion carrying text.markdown (blank-content trap)", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-image", type: "text", text: { format: 2, markdown: "# converted" } }]
      });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.markdown");
      expect(response.error.message).toContain("first");
    });

    it("accepts a one-step pdf->text conversion carrying HTML text.content", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-pdf", type: "text", text: { format: 1, content: "<p>converted</p>" } }]
      });
      expect(response.ok).toBe(true);
    });

    it("rejects an empty image.caption clear-attempt on a text-type page, naming image-type pages", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", image: { caption: "" } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image-type pages");
    });

    it("accepts an HTML->markdown format switch (format 2 + text.markdown) on a text page", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-text", text: { format: 2, markdown: "# x" } }]
      });
      expect(response.ok).toBe(true);
    });

    it("accepts a markdown->HTML format switch (format 1 + text.content) on a text page", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-md", text: { format: 1, content: "<p>x</p>" } }]
      });
      expect(response.ok).toBe(true);
    });

    it("rejects a format-only HTML->markdown switch that omits text.markdown (blank-content trap)", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", text: { format: 2 } }] });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("text.markdown");
    });

    it("accepts a format-only HTML->markdown switch on an EMPTY text page", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-empty-text", text: { format: 2 } }] });
      expect(response.ok).toBe(true);
    });

    it("accepts an HTML->markdown switch that explicitly clears via text.markdown:'' on a page with content", async () => {
      const response = await updateGuard({ pages: [{ id: "gp-text", text: { format: 2, markdown: "" } }] });
      expect(response.ok).toBe(true);
    });

    it("does NOT guard a system-subtype page (passes arbitrary text/system through)", async () => {
      const response = await updateGuard({
        pages: [{ id: "gp-dnd5e", text: { content: "kept" }, system: { tooltip: "t" } }]
      });
      expect(response.ok).toBe(true);
    });

    it("rejects an update to a non-existent page id with a not-found error, not a cross-type field message", async () => {
      const response = await updateGuard({
        pages: [{ id: "does-not-exist", image: { caption: "x" } }]
      });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("One or more journal pages were not found");

      expect(response.error.message).toContain("journal.get");
      expect(response.error.message).not.toContain("image.caption");
      expect(response.error.details.missingPageIds).toEqual(["does-not-exist"]);
    });

    it("guards fire identically under dry-run", async () => {
      const response = await makeRouter().route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          dryRun: true,
          patch: { pages: [{ id: "gp-image", text: { content: "nope" } }] }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image.caption");
    });

    it("guards new pages added via journal.update (create path)", async () => {
      const response = await updateGuard({
        pages: [{ name: "New cover", type: "image", text: { content: "nope" } }]
      });
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image.caption");
    });

    it("guards inline pages on journal.create", async () => {
      const response = await makeRouter().route(
        createRequest("journal.create", {
          data: { name: "New Journal", pages: [{ name: "Cover", type: "image", text: { content: "nope" } }] }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image.caption");
    });

    it("accepts image.caption on an image-type page and reaches updateEmbeddedDocuments", async () => {
      const router = makeRouter();
      const response = await router.route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: "gp-image", image: { caption: "The keep at dusk" } }] }
        })
      );
      expect(response.ok).toBe(true);
      const updated = response.result.journal.pages.find((page) => page.id === "gp-image");
      expect(updated.image).toEqual({ caption: "The keep at dusk" });
    });

    it("writes back the default `video` object journal.get returns for a TEXT page", async () => {
      const router = makeRouter();
      const getResponse = await router.route(createRequest("journal.get", { journalId: "journal-guard" }));
      expect(getResponse.ok).toBe(true);
      const textPage = getResponse.result.journal.pages.find((page) => page.id === "gp-text");

      expect(textPage.video).toEqual({ controls: true, volume: 0.5 });

      const response = await router.route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: textPage.id, video: textPage.video }] }
        })
      );
      expect(response.ok).toBe(true);
    });

    it("writes back the default `text` object journal.get returns for an IMAGE page", async () => {
      const router = makeRouter();
      const getResponse = await router.route(createRequest("journal.get", { journalId: "journal-guard" }));
      expect(getResponse.ok).toBe(true);
      const imagePage = getResponse.result.journal.pages.find((page) => page.id === "gp-image");
      expect(imagePage.text).toEqual({ format: 1 });

      const response = await router.route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: imagePage.id, text: imagePage.text }] }
        })
      );
      expect(response.ok).toBe(true);
    });
  });

  describe("journal page category membership guard", () => {
    const makeRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    it("rejects a page update whose category id is not a member of the journal's categories", async () => {
      const response = await makeRouter().route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: "gp-text", category: "cat-nonexistent" }] }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("cat-nonexistent");
      expect(response.error.message).toContain("categories");

      expect(response.error.message).toContain("journal.category.list");
      expect(response.error.message).toContain("journal.category.create");
      expect(response.error.details.category).toBe("cat-nonexistent");
    });

    it("rejects a new-in-update page whose category is not a member", async () => {
      const response = await makeRouter().route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ name: "New lore", type: "text", category: "cat-nonexistent" }] }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("cat-nonexistent");
    });

    it("accepts a page update whose category IS a member of the journal's categories", async () => {
      const router = makeRouter();
      const response = await router.route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: "gp-text", category: "cat-lore" }] }
        })
      );
      expect(response.ok).toBe(true);
      const updated = response.result.journal.pages.find((page) => page.id === "gp-text");
      expect(updated.category).toBe("cat-lore");
    });

    it("accepts a page update that leaves the page uncategorized (category:null)", async () => {
      const response = await makeRouter().route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: "gp-text", category: null }] }
        })
      );
      expect(response.ok).toBe(true);
    });

    it("fires under dry-run (a dangling category fails the preview)", async () => {
      const response = await makeRouter().route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          dryRun: true,
          patch: { pages: [{ id: "gp-text", category: "cat-nonexistent" }] }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("cat-nonexistent");
    });

    it("rejects a category on an inline journal.create page (no categories exist yet)", async () => {
      const response = await makeRouter().route(
        createRequest("journal.create", {
          data: {
            name: "Fresh Journal",
            pages: [{ name: "Lore", type: "text", category: "cat-anything" }]
          }
        })
      );
      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("cannot set 'category'");

      expect(response.error.message).toContain("journal.category.create");
      expect(response.error.message).not.toContain("in Foundry");
      expect(response.error.details.category).toBe("cat-anything");
    });

    it("accepts an inline journal.create page with no category", async () => {
      const response = await makeRouter().route(
        createRequest("journal.create", {
          data: { name: "Fresh Journal", pages: [{ name: "Lore", type: "text", category: null }] }
        })
      );
      expect(response.ok).toBe(true);
    });

    it("normalizes an empty-string page category to null on update (Foundry rejects blank ids)", async () => {
      const response = await makeRouter().route(
        createRequest("journal.update", {
          journalId: "journal-guard",
          patch: { pages: [{ id: "gp-text", category: "" }] }
        })
      );
      expect(response.ok).toBe(true);
      const updated = response.result.journal.pages.find((page) => page.id === "gp-text");

      expect(updated.category).toBeNull();
    });

    it("accepts an inline journal.create page with an empty-string category (normalized to null)", async () => {
      const response = await makeRouter().route(
        createRequest("journal.create", {
          data: { name: "Fresh Journal", pages: [{ name: "Lore", type: "text", category: "" }] }
        })
      );
      expect(response.ok).toBe(true);
    });
  });

  it("returns a stable not-found error for missing journals", async () => {
    const router = createCommandRouter({
      bridgeClient: {
        getStatus: () => ({ status: "connected" })
      }
    });

    const response = await router.route(createRequest("journal.get", { journalId: "missing-journal" }));

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("JOURNAL_NOT_FOUND");
  });

  describe("journal.category.* embedded family", () => {
    const makeRouter = () =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const run = (command, params) => makeRouter().route(createRequest(command, params));

    it("lists categories ordered by `sort`, NOT by collection order", async () => {
      const response = await run("journal.category.list", { journalId: "journal-categories" });
      expect(response.ok).toBe(true);
      expect(response.result.journalId).toBe("journal-categories");

      expect(response.result.categories.map((row) => row.id)).toEqual([
        "cat-chapter-one",
        "cat-chapter-two",
        "cat-blank"
      ]);
      expect(response.result.total).toBe(3);
      expect(response.result.hasMore).toBe(false);
    });

    it("list rows are LEAN (id/_id mirror + name + sort, NO flags) while get carries flags", async () => {
      const listResponse = await run("journal.category.list", { journalId: "journal-categories" });
      const row = listResponse.result.categories.find((entry) => entry.id === "cat-chapter-two");
      expect(Object.keys(row).sort()).toEqual(["_id", "id", "name", "sort"]);
      expect(row._id).toBe(row.id);
      expect(row.sort).toBe(200);

      const getResponse = await run("journal.category.get", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-two"
      });
      expect(getResponse.ok).toBe(true);
      expect(getResponse.result.journalId).toBe("journal-categories");
      expect(Object.keys(getResponse.result.category).sort()).toEqual(["_id", "flags", "id", "name", "sort"]);

      expect(getResponse.result.category.flags).toEqual({ mymod: { colour: "blue" } });

      expect(getResponse.result.category).not.toHaveProperty("ownership");
      expect(getResponse.result.category).not.toHaveProperty("compendiumSource");
      expect(getResponse.result.category).not.toHaveProperty("_stats");
    });

    it("reads `name` from SOURCE, never the localized name Foundry derives for a BLANK one", async () => {
      const live = globalThis.game.journal.get("journal-categories").categories.get("cat-blank");
      expect(live.name).toBe("Unnamed Category");
      expect(live._source.name).toBe("");

      const getResponse = await run("journal.category.get", {
        journalId: "journal-categories",
        categoryId: "cat-blank"
      });
      expect(getResponse.result.category.name).toBe("");

      const listResponse = await run("journal.category.list", { journalId: "journal-categories" });
      expect(listResponse.result.categories.find((row) => row.id === "cat-blank").name).toBe("");

      const journalResponse = await run("journal.get", { journalId: "journal-categories" });
      const subSummary = journalResponse.result.journal.categories.find((row) => row.id === "cat-blank");
      expect(subSummary.name).toBe("");
    });

    it("keeps journal.get's categories[] sub-summary at {id, name, sort} (shape pinned, not re-implemented)", async () => {
      const response = await run("journal.get", { journalId: "journal-categories" });
      const rows = response.result.journal.categories;
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(["id", "name", "sort"]);

        expect(row).not.toHaveProperty("_id");
      }

      expect(response.result.journal.categories.map((row) => row.id)).toEqual([
        "cat-chapter-one",
        "cat-chapter-two",
        "cat-blank"
      ]);
      const listResponse = await run("journal.category.list", { journalId: "journal-categories" });
      expect(response.result.journal.categories.map((row) => row.id)).toEqual(
        listResponse.result.categories.map((row) => row.id)
      );
    });

    it("the list `name` filter matches the STORED name (filter and projection cannot disagree)", async () => {
      const matched = await run("journal.category.list", {
        journalId: "journal-categories",
        name: "chapter"
      });
      expect(matched.result.categories.map((row) => row.id)).toEqual(["cat-chapter-one", "cat-chapter-two"]);
      expect(matched.result.total).toBe(2);

      const derived = await run("journal.category.list", {
        journalId: "journal-categories",
        name: "Unnamed"
      });
      expect(derived.result.categories).toEqual([]);
      expect(derived.result.total).toBe(0);
    });

    it("paginates (filter applied server-side BEFORE pagination)", async () => {
      const response = await run("journal.category.list", {
        journalId: "journal-categories",
        name: "chapter",
        limit: 1,
        offset: 1
      });
      expect(response.result.categories.map((row) => row.id)).toEqual(["cat-chapter-two"]);
      expect(response.result.total).toBe(2);
      expect(response.result.hasMore).toBe(false);
    });

    it("resolves the PARENT first: a bad journalId is JOURNAL_NOT_FOUND on every verb", async () => {
      /** @type {[string, Record<string, any>][]} */
      const cases = [
        ["journal.category.list", { journalId: "missing-journal" }],
        ["journal.category.get", { journalId: "missing-journal", categoryId: "cat-chapter-one" }],
        ["journal.category.create", { journalId: "missing-journal", data: { name: "X" } }],
        [
          "journal.category.update",
          { journalId: "missing-journal", categoryId: "cat-chapter-one", patch: { name: "X" } }
        ],
        ["journal.category.delete", { journalId: "missing-journal", categoryId: "cat-chapter-one" }]
      ];
      for (const [command, params] of cases) {
        const response = await run(command, params);
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe("JOURNAL_NOT_FOUND");
      }
    });

    it("a bad categoryId on a REAL journal is JOURNAL_CATEGORY_NOT_FOUND (never JOURNAL_NOT_FOUND)", async () => {
      for (const command of ["journal.category.get", "journal.category.update", "journal.category.delete"]) {
        const response = await run(command, {
          journalId: "journal-categories",
          categoryId: "cat-nope",
          ...(command === "journal.category.update" ? { patch: { name: "X" } } : {})
        });
        expect(response.ok, command).toBe(false);
        expect(response.error.code, command).toBe("JOURNAL_CATEGORY_NOT_FOUND");
        expect(response.error.message, command).toContain("journal.category.list");
        expect(response.error.details.journalId).toBe("journal-categories");
        expect(response.error.details.categoryId).toBe("cat-nope");
      }
    });

    it("BOTH ids missing resolves the parent first (precedence pinned, not incidental)", async () => {
      const response = await run("journal.category.get", {
        journalId: "missing-journal",
        categoryId: "cat-nope"
      });
      expect(response.error.code).toBe("JOURNAL_NOT_FOUND");
    });

    it("creates a category and returns the FULL projection", async () => {
      const response = await run("journal.category.create", {
        journalId: "journal-categories",
        data: { name: "Appendix", sort: 400, flags: { mymod: { x: 1 } } }
      });
      expect(response.ok).toBe(true);
      expect(response.result.journalId).toBe("journal-categories");
      expect(response.result.category.name).toBe("Appendix");
      expect(response.result.category.sort).toBe(400);
      expect(response.result.category.flags).toEqual({ mymod: { x: 1 } });
      expect(response.result.category.id).toBeTruthy();
      expect(response.result.category._id).toBe(response.result.category.id);
    });

    it('creates a BLANK-named category and reports the STORED "", not the derived name', async () => {
      const response = await run("journal.category.create", {
        journalId: "journal-categories",
        data: { name: "" }
      });
      expect(response.ok).toBe(true);
      expect(response.result.category.name).toBe("");
    });

    it('reports a WHITESPACE-only name as the "" Foundry actually stores (the field TRIMS)', async () => {
      const response = await run("journal.category.create", {
        journalId: "journal-categories",
        data: { name: "   " }
      });
      expect(response.ok).toBe(true);

      expect(response.result.category.name).toBe("");
    });

    it("dry-run creates NOTHING, mints NO id, and returns the same body shape as the real call", async () => {
      const before = globalThis.game.journal.get("journal-categories").categories.size;
      const response = await run("journal.category.create", {
        journalId: "journal-categories",
        data: { name: "Preview Only", sort: 500 },
        dryRun: true
      });
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.journalId).toBe("journal-categories");
      expect(response.result.category.name).toBe("Preview Only");
      expect(response.result.category.sort).toBe(500);

      expect(response.result.category.id).toBeNull();
      expect(response.result.category._id).toBeNull();
      expect(globalThis.game.journal.get("journal-categories").categories.size).toBe(before);
    });

    it("the dry-run preview does NOT contaminate the payload the real create would send", async () => {
      const journalDoc = globalThis.game.journal.get("journal-categories");
      journalDoc.createEmbeddedDocuments.mockClear();
      const response = await run("journal.category.create", {
        journalId: "journal-categories",
        data: { name: "Clean Payload" }
      });
      expect(response.ok).toBe(true);
      const [, entries] = journalDoc.createEmbeddedDocuments.mock.calls.at(-1);
      expect(Object.keys(entries[0]).sort()).toEqual(["name"]);
      expect(entries[0]).not.toHaveProperty("_id");
      expect(entries[0]).not.toHaveProperty("_stats");
    });

    it("a create Foundry SILENTLY DROPS is an error, never ok:true (write-confirmation invariant)", async () => {
      const refusing = createJournalDocument("journal-refuse-create", {
        name: "Refuses",
        categories: [],
        pages: [],
        refuseCategoryWrites: "create"
      });
      globalThis.game.journal.set(refusing);
      try {
        const response = await run("journal.category.create", {
          journalId: "journal-refuse-create",
          data: { name: "Never lands" }
        });
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("INTERNAL_ERROR");

        expect(response.error.message).toContain("returned no document");

        expect(response.error.message).toContain("preCreateJournalEntryCategory");
        expect(response.error.message).toContain("no force flag");
        expect(response.error.details.journalId).toBe("journal-refuse-create");
      } finally {
        globalThis.game.journal.delete("journal-refuse-create");
      }
    });

    it("updates a category and returns the merged FULL projection", async () => {
      const response = await run("journal.category.update", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-one",
        patch: { name: "Chapter I", sort: 150 }
      });
      expect(response.ok).toBe(true);
      expect(response.result.category.name).toBe("Chapter I");
      expect(response.result.category.sort).toBe(150);

      await run("journal.category.update", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-one",
        patch: { name: "Chapter One", sort: 100 }
      });
    });

    it("accepts a NO-OP patch (the diff probe distinguishes an empty diff from a veto)", async () => {
      const response = await run("journal.category.update", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-two",
        patch: { name: "Chapter Two" }
      });
      expect(response.ok).toBe(true);
      expect(response.result.category.name).toBe("Chapter Two");
    });

    it("an update Foundry SILENTLY REFUSES is an INTERNAL_ERROR naming the hook and the fields", async () => {
      const refusing = createJournalDocument("journal-refuse-update", {
        name: "Refuses",
        categories: [{ id: "cat-locked", name: "Locked", sort: 10 }],
        pages: [],
        refuseCategoryWrites: "update"
      });
      globalThis.game.journal.set(refusing);
      try {
        const response = await run("journal.category.update", {
          journalId: "journal-refuse-update",
          categoryId: "cat-locked",
          patch: { name: "Renamed" }
        });
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("INTERNAL_ERROR");
        expect(response.error.message).toContain("preUpdateJournalEntryCategory");
        expect(response.error.message).toContain("was NOT updated");

        expect(response.error.message).toContain("locks this journal");
        expect(response.error.details.fields).toContain("name");
        expect(response.error.details.categoryId).toBe("cat-locked");

        expect(response.error.details.journalId).toBe("journal-refuse-update");

        expect(refusing.categories.get("cat-locked")._source.name).toBe("Locked");
      } finally {
        globalThis.game.journal.delete("journal-refuse-update");
      }
    });

    it("a row REMOVED while the update was in flight is JOURNAL_CATEGORY_NOT_FOUND, NOT a veto", async () => {
      const vanishing = createJournalDocument("journal-vanishing-row", {
        name: "Vanishes",
        categories: [{ id: "cat-vanishes", name: "Doomed", sort: 10 }],
        pages: []
      });
      vanishing.updateEmbeddedDocuments = vi.fn(async (type, entries) => {
        expect(type).toBe("JournalEntryCategory");
        expect(entries[0]._id).toBe("cat-vanishes");
        vanishing.categories.delete("cat-vanishes");
        return [];
      });
      globalThis.game.journal.set(vanishing);
      try {
        const response = await run("journal.category.update", {
          journalId: "journal-vanishing-row",
          categoryId: "cat-vanishes",
          patch: { name: "Renamed" }
        });
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("JOURNAL_CATEGORY_NOT_FOUND");

        expect(response.error.details.removedDuringUpdate).toBe(true);
        expect(response.error.details.journalId).toBe("journal-vanishing-row");
        expect(response.error.details.categoryId).toBe("cat-vanishes");

        expect(response.error.message).not.toContain("was NOT updated");
        expect(response.error.message).not.toContain("locks this journal");
        expect(response.error.message).not.toContain("construction API");
        expect(response.error.message).toContain("NOT a module veto");
        expect(response.error.message).toContain("journal.category.list");
        expect(response.error.details.validationError).toBeUndefined();

        expect(response.result).toBeUndefined();
      } finally {
        globalThis.game.journal.delete("journal-vanishing-row");
      }
    });

    it("update dry-run merges without persisting", async () => {
      const response = await run("journal.category.update", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-one",
        patch: { name: "Previewed" },
        dryRun: true
      });
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.category.name).toBe("Previewed");
      expect(
        globalThis.game.journal.get("journal-categories").categories.get("cat-chapter-one")._source.name
      ).toBe("Chapter One");
    });

    it('a BLANK RENAME reports the stored "" on BOTH the real call and the dry run', async () => {
      const renaming = createJournalDocument("journal-blank-rename", {
        name: "Renames",
        categories: [{ id: "cat-named", name: "Named", sort: 10 }],
        pages: []
      });
      globalThis.game.journal.set(renaming);
      try {
        const previewProbe = await renaming.categories
          .get("cat-named")
          .clone({}, { keepId: true, save: false });
        previewProbe.updateSource({ name: "" });
        expect(previewProbe._source.name).toBe("");
        expect(previewProbe.name).toBe("Unnamed Category");

        const dry = await run("journal.category.update", {
          journalId: "journal-blank-rename",
          categoryId: "cat-named",
          patch: { name: "" },
          dryRun: true
        });
        expect(dry.ok).toBe(true);
        expect(dry.result.dryRun).toBe(true);
        expect(dry.result.category.name).toBe("");

        expect(renaming.categories.get("cat-named")._source.name).toBe("Named");

        const real = await run("journal.category.update", {
          journalId: "journal-blank-rename",
          categoryId: "cat-named",
          patch: { name: "" }
        });
        expect(real.ok).toBe(true);
        expect(real.result.category.name).toBe("");

        const stored = renaming.categories.get("cat-named");
        expect(stored._source.name).toBe("");
        expect(stored.name).toBe("Unnamed Category");

        const reread = await run("journal.category.get", {
          journalId: "journal-blank-rename",
          categoryId: "cat-named"
        });
        expect(reread.result.category.name).toBe("");
      } finally {
        globalThis.game.journal.delete("journal-blank-rename");
      }
    });

    it("deletes a referenced category, MIRRORING Foundry, and reports the pages left dangling", async () => {
      const response = await run("journal.category.delete", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-one"
      });
      expect(response.ok).toBe(true);
      expect(response.result.deleted).toBe(true);
      expect(response.result.id).toBe("cat-chapter-one");
      expect(response.result.journalId).toBe("journal-categories");

      expect(response.result.danglingPageCount).toBe(2);
      expect(response.result.danglingPageIds.sort()).toEqual(["cj-page-a", "cj-page-b"]);
      expect(response.result.danglingPageIdsTruncated).toBe(false);

      const journalDoc = globalThis.game.journal.get("journal-categories");
      expect(journalDoc.pages.get("cj-page-a").toObject().category).toBe("cat-chapter-one");
      expect(journalDoc.categories.get("cat-chapter-one")).toBeFalsy();

      journalDoc.categories.set(
        createJournalCategoryDocument("cat-chapter-one", {
          name: "Chapter One",
          sort: 100
        })
      );
    });

    it("reports zero dangling pages for an UNREFERENCED category", async () => {
      const response = await run("journal.category.delete", {
        journalId: "journal-categories",
        categoryId: "cat-blank"
      });
      expect(response.ok).toBe(true);
      expect(response.result.danglingPageCount).toBe(0);
      expect(response.result.danglingPageIds).toEqual([]);
      globalThis.game.journal
        .get("journal-categories")
        .categories.set(createJournalCategoryDocument("cat-blank", { name: "", sort: 300 }));
    });

    it("counts ONLY the deleted category's pages — never another category's, never an orphan's", async () => {
      const response = await run("journal.category.delete", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-two"
      });
      expect(response.ok).toBe(true);

      expect(response.result.danglingPageIds).toEqual(["cj-page-c"]);
      expect(response.result.danglingPageCount).toBe(1);
      globalThis.game.journal.get("journal-categories").categories.set(
        createJournalCategoryDocument("cat-chapter-two", {
          name: "Chapter Two",
          sort: 200,
          flags: { mymod: { colour: "blue" } }
        })
      );
    });

    it("delete dry-run FORECASTS the same consequence block and deletes nothing", async () => {
      const response = await run("journal.category.delete", {
        journalId: "journal-categories",
        categoryId: "cat-chapter-one",
        dryRun: true
      });
      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);
      expect(response.result.deleted).toBe(false);

      expect(response.result.danglingPageCount).toBe(2);
      expect(response.result.danglingPageIds.sort()).toEqual(["cj-page-a", "cj-page-b"]);
      expect(response.result.danglingPageIdsTruncated).toBe(false);
      expect(
        globalThis.game.journal.get("journal-categories").categories.get("cat-chapter-one")
      ).toBeDefined();
    });

    it("CAPS the dangling id list while the COUNT stays exact", async () => {
      const many = createJournalDocument("journal-many-pages", {
        name: "Many",
        categories: [{ id: "cat-many", name: "Many", sort: 10 }],
        pages: Array.from({ length: 60 }, (unused, index) => ({
          id: `mp-${index}`,
          name: `P${index}`,
          type: "text",
          category: "cat-many"
        }))
      });
      globalThis.game.journal.set(many);
      try {
        const response = await run("journal.category.delete", {
          journalId: "journal-many-pages",
          categoryId: "cat-many"
        });
        expect(response.ok).toBe(true);

        expect(response.result.danglingPageCount).toBe(60);
        expect(response.result.danglingPageIds).toHaveLength(50);
        expect(response.result.danglingPageIdsTruncated).toBe(true);
      } finally {
        globalThis.game.journal.delete("journal-many-pages");
      }
    });

    it("does NOT count a page of a DIFFERENT journal that stores the same category id", async () => {
      const other = createJournalDocument("journal-other-same-id", {
        name: "Other",
        categories: [],
        pages: [{ id: "op-1", name: "Shares an id", type: "text", category: "cat-shared" }]
      });
      const owner = createJournalDocument("journal-owns-shared", {
        name: "Owner",
        categories: [{ id: "cat-shared", name: "Shared", sort: 10 }],
        pages: [{ id: "wp-1", name: "Mine", type: "text", category: "cat-shared" }]
      });
      globalThis.game.journal.set(other);
      globalThis.game.journal.set(owner);
      try {
        const response = await run("journal.category.delete", {
          journalId: "journal-owns-shared",
          categoryId: "cat-shared"
        });
        expect(response.ok).toBe(true);
        expect(response.result.danglingPageIds).toEqual(["wp-1"]);
        expect(response.result.danglingPageCount).toBe(1);
      } finally {
        globalThis.game.journal.delete("journal-other-same-id");
        globalThis.game.journal.delete("journal-owns-shared");
      }
    });

    it("a delete Foundry SILENTLY REFUSES is an INTERNAL_ERROR, never deleted:true", async () => {
      const refusing = createJournalDocument("journal-refuse-delete", {
        name: "Refuses",
        categories: [{ id: "cat-undeletable", name: "Locked", sort: 10 }],
        pages: [],
        refuseCategoryWrites: "delete"
      });
      globalThis.game.journal.set(refusing);
      try {
        const response = await run("journal.category.delete", {
          journalId: "journal-refuse-delete",
          categoryId: "cat-undeletable"
        });
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe("INTERNAL_ERROR");
        expect(response.error.message).toContain("preDeleteJournalEntryCategory");
        expect(response.error.message).toContain("was NOT deleted");

        expect(response.error.details.journalId).toBe("journal-refuse-delete");
        expect(response.error.details.categoryId).toBe("cat-undeletable");
        expect(refusing.categories.get("cat-undeletable")).toBeDefined();
      } finally {
        globalThis.game.journal.delete("journal-refuse-delete");
      }
    });
  });

  it("clones and deletes journals", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const cloneResponse = await router.route(
      createRequest("journal.clone", { journalId: "journal-1", patch: { name: "Journal Copy" } })
    );
    expect(cloneResponse.ok).toBe(true);
    expect(cloneResponse.result.journal.id).toBe("journal-1-clone");
    expect(cloneResponse.result.journal.name).toBe("Journal Copy");

    expect(cloneResponse.result.journal.pages).toHaveLength(1);
    expect(cloneResponse.result.journal.pages[0].name).toBe("Overview");

    const deleteResponse = await router.route(createRequest("journal.delete", { journalId: "journal-1" }));
    expect(deleteResponse.ok).toBe(true);
    expect(deleteResponse.result).toMatchObject({ id: "journal-1", deleted: true });
  });

  it("deletes journal pages through journal.update", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: { deletePageIds: ["page-1"] }
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.journal.pages.some((page) => page.id === "page-1")).toBe(false);
  });

  it("returns INVALID_PARAMS when deleting a non-existent journal page", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });

    const response = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: { deletePageIds: ["does-not-exist"] }
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
  });

  it("journal.update dry-run runs the deletePageIds existence guard (INVALID_PARAMS for a bogus id)", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const journal = globalThis.game.journal.get("journal-1");

    const response = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: { deletePageIds: ["does-not-exist"] },
        dryRun: true
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("INVALID_PARAMS");
    expect(journal.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("journal.update dry-run with a valid deletePageId returns dryRun:true without deleting", async () => {
    const router = createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } });
    const journal = globalThis.game.journal.get("journal-1");

    const response = await router.route(
      createRequest("journal.update", {
        journalId: "journal-1",
        patch: { deletePageIds: ["page-1"] },
        dryRun: true
      })
    );

    expect(response.ok).toBe(true);
    expect(response.result.dryRun).toBe(true);

    expect(response.result.journal.pages.some((page) => page.id === "page-1")).toBe(false);
    expect(journal.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  describe("journal.update dry-run POST-MERGE preview (all four page ops)", () => {
    const dryUpdate = (patch) =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } }).route(
        createRequest("journal.update", { journalId: "journal-preview", patch, dryRun: true })
      );

    it("previews a page CREATE (appended, null _id) without persisting", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await dryUpdate({
        pages: [{ name: "New Cover", type: "image", image: { caption: "fresh" } }]
      });

      expect(response.ok).toBe(true);
      expect(response.result.dryRun).toBe(true);

      expect(response.result.journal.pages).toHaveLength(3);
      expect(response.result).not.toHaveProperty("preview");
      const created = response.result.journal.pages[2];
      expect(created.id).toBeNull();
      expect(created._id).toBeNull();
      expect(created.name).toBe("New Cover");
      expect(created.type).toBe("image");
      expect(created.image.caption).toBe("fresh");
      expect(journal.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("previews a page UPDATE (merged values, authored subtree preserved) without persisting — the caption incident", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await dryUpdate({
        pages: [{ id: "pv-image", image: { caption: "The keep at dusk" } }]
      });

      expect(response.ok).toBe(true);
      const previewImage = response.result.journal.pages.find((page) => page.id === "pv-image");

      expect(previewImage.image.caption).toBe("The keep at dusk");

      expect(previewImage.src).toBe("worlds/w/art/keep.webp");

      expect(journal.updateEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("previews a page DELETE (page absent) without persisting", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await dryUpdate({ deletePageIds: ["pv-text"] });

      expect(response.ok).toBe(true);

      expect(response.result.journal.pages.some((page) => page.id === "pv-text")).toBe(false);
      expect(response.result.journal.pages).toHaveLength(1);

      expect(journal.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("shows a no-op patch as a VISIBLE no-op (merged doc keeps the current value)", async () => {
      const response = await dryUpdate({
        pages: [{ id: "pv-image", image: { caption: "The keep at dawn" } }]
      });

      expect(response.ok).toBe(true);

      const previewImage = response.result.journal.pages.find((page) => page.id === "pv-image");
      expect(previewImage.image.caption).toBe("The keep at dawn");
    });

    it("FAILS an invalid page UPDATE (DataModel rejects the field) exactly as the real call would", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await dryUpdate({ pages: [{ id: "pv-text", badField: true }] });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(journal.updateEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("FAILS an invalid page CREATE (DataModel rejects the field) exactly as the real call would", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await dryUpdate({
        pages: [{ name: "Bad", type: "text", badField: true }]
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(journal.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("still FAILS an inert cross-type write under dry-run: text.content on an image page", async () => {
      const response = await dryUpdate({ pages: [{ id: "pv-image", text: { content: "nope" } }] });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(response.error.message).toContain("image");
    });

    it("collapses duplicate page ids to the LAST payload (matches Foundry's batch dedup)", async () => {
      const response = await dryUpdate({
        pages: [
          { id: "pv-text", name: "First rename" },
          { id: "pv-text", sort: 99 }
        ]
      });

      expect(response.ok).toBe(true);
      const previewText = response.result.journal.pages.find((page) => page.id === "pv-text");

      expect(previewText.sort).toBe(99);

      expect(previewText.name).toBe("Notes");
    });

    it("does NOT let a trailing no-op duplicate mask an earlier real change", async () => {
      const response = await dryUpdate({
        pages: [
          { id: "pv-text", name: "First rename" },

          { id: "pv-text", sort: 0 }
        ]
      });

      expect(response.ok).toBe(true);
      const previewText = response.result.journal.pages.find((page) => page.id === "pv-text");

      expect(previewText.name).toBe("First rename");
    });

    it("regression: a document-level-only patch previews the merged doc with pages unchanged", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await dryUpdate({ name: "Renamed Preview" });

      expect(response.ok).toBe(true);

      expect(response.result.journal.name).toBe("Renamed Preview");

      expect(response.result.journal.pages).toHaveLength(2);
      expect(journal.update).not.toHaveBeenCalled();
    });
  });

  describe("journal.update REAL path pre-validates page ops (parity with dry-run)", () => {
    const realUpdate = (patch) =>
      createCommandRouter({ bridgeClient: { getStatus: () => ({ status: "connected" }) } }).route(
        createRequest("journal.update", { journalId: "journal-preview", patch })
      );

    it("FAILS an invalid page UPDATE with INVALID_PARAMS and never calls updateEmbeddedDocuments", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await realUpdate({ pages: [{ id: "pv-text", badField: true }] });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(journal.updateEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("FAILS an invalid page CREATE with INVALID_PARAMS and never calls createEmbeddedDocuments", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await realUpdate({
        pages: [{ name: "Bad", type: "text", badField: true }]
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("INVALID_PARAMS");
      expect(journal.createEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it("still APPLIES a valid real page create+update through the embedded write API", async () => {
      const journal = globalThis.game.journal.get("journal-preview");
      const response = await realUpdate({
        pages: [
          { id: "pv-text", text: { content: "Edited notes" } },
          { name: "Fresh Cover", type: "image", image: { caption: "new" } }
        ]
      });

      expect(response.ok).toBe(true);

      expect(journal.updateEmbeddedDocuments).toHaveBeenCalled();
      expect(journal.createEmbeddedDocuments).toHaveBeenCalled();
    });
  });
});
