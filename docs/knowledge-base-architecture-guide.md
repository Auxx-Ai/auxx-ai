# Knowledge Base Architecture Guide

The Knowledge Base (KB) system covers the data model, the authoring editor
(`apps/web`), the public reader site (`apps/kb`), the AI/embedding pipeline, and
how Kopilot reads and edits articles. Verified against the implementation on
**2026-07-09**.

External content ingestion (crawling websites, manual entries, future
connectors) is a separate but tightly-integrated system — see
`docs/knowledge-sources-architecture-guide.md`. This guide covers only what a
"native" KB does; Knowledge Sources is documented where it touches KB
primitives (§2, §6).

---

## 1. The shape in one paragraph

A **KnowledgeBase** belongs to an org. Content lives in **Article** rows, but
an article's *tree position* and *publish state* live separately, on
**ArticlePlacement** — one article can be placed into multiple KBs at once
(multi-home), each placement with its own parent, sort order, and published
revision. Every article has exactly one working **draft** (`Article.draftRevisionId`
→ an `ArticleRevision` with `versionNumber = NULL`); publishing a placement
snapshots the draft into a new immutable numbered revision and points that
placement's `publishedRevisionId` at it. If `aiEnabled`, the article's content
embeds exactly once into its **home KB's** managed **Dataset** — every KB it's
also placed into shares that same embedding, not a duplicate. The editor in
`apps/web` edits the one shared draft with optimistic Zustand stores; the
public site `apps/kb` renders only published placements. Kopilot reads
articles anywhere via `search_knowledge` / `get_article` and, on the KB editor
page, edits the draft through markdown-first, stable-id **block-CRUD** tools,
with a full diff engine backing version history, pre-publish review, and
Kopilot turn review (Keep/Undo).

---

## 2. Data model (`packages/database/src/db/schema/`)

### Core tables

| Table | File | Role |
| --- | --- | --- |
| `KnowledgeBase` | `knowledge-base.ts` | Org-scoped KB. `kind` (`standard`\|`source` — source-KBs are hidden, see Knowledge Sources), `slug`, `customDomain`, `visibility` (PUBLIC\|INTERNAL), `publishStatus` (DRAFT\|PUBLISHED\|UNLISTED), `datasetId` (managed embeddings), `draftSettings` (JSONB staging for theme/layout), theme/color/font/nav columns. |
| `Article` | `article.ts` | **Canonical content only** — no tree/publish state. `articleKind` (page\|category\|header\|tab\|link), `status` (DRAFT\|PUBLISHED\|ARCHIVED), `draftRevisionId` (the single working draft), `aiEnabled`, `viewsCount`. `homeKnowledgeBaseId` (NOT NULL) is the **canonical embedding owner** — provenance, not tree placement. `sourceId`/`sourceExternalId`/`sourceContentHash`/`managed` are Knowledge-Sources provenance fields (content-level, distinct from a placement being source-linked). Denormalizes `title`/`emoji`/`excerpt`/`color` from the home placement's published (falling back to draft) revision for fast sidebar render (`sync-article-denormalized-fields.ts`). |
| `ArticlePlacement` | `article-placement.ts` | **One tree position + publish state per KnowledgeBase.** `articleId` (FK→Article, cascade), `knowledgeBaseId` (the tree-position KB — independent of `Article.homeKnowledgeBaseId`), `slug` (unique per `(knowledgeBaseId, slug)`), `parentId` (self-FK — parent *placement*, not parent article), `sortOrder`, `isPublished`, `publishedAt`, `publishedRevisionId` (per-placement, FK→ArticleRevision), `publishedById`, `hasUnpublishedChanges`, `linkedFromSourceId` (nullable FK→KnowledgeSource — `null` = native placement, set = this placement is a materialized link to source content). Invariant: ≥1 placement per article (multi-home); ≤1 placement per `(article, KB)` pair, enforced in code (`internal/placement.ts`), not a DB constraint. |
| `ArticleRevision` | `article-revision.ts` | Versioned content. `versionNumber` (**NULL = the one draft**, integer = immutable published snapshot), `content` (HTML), `contentJson` (jsonb `ArticleNodeJSON[]`), `title`/`description`/`excerpt`/`emoji`/`color`, `coverImageId`, `editorId`, `label`. One row is pointed to by `Article.draftRevisionId`; separately, each `ArticlePlacement.publishedRevisionId` points to whichever revision that placement exposes — two placements of the same article can be at different revisions until each is republished. |
| `KnowledgeSource` | `knowledge-source.ts` | Ingest config (`type`, `config` jsonb, `surface` publishable\|ai-only). `ownedKnowledgeBaseId` — the hidden `kind='source'` KB that homes synced articles. See `docs/knowledge-sources-architecture-guide.md`. |

**Key invariant:** block ids inside `contentJson` are **stable across
versions** — publish/restore copy the JSON verbatim, ids included. This is
what makes id-keyed block CRUD and version diffing reliable.

### Hierarchy & ordering

`ArticlePlacement.parentId` builds the tree (in **placement-id space**, not
article-id space); `articleKind` distinguishes leaf `page`s from container
`category`/`tab`/`header` nodes and external `link`s. `sortOrder` is a
fractional string (no renumber on reorder). Tree ordering is fully KB-scoped
and placement-owned — `Article` itself has no ordering fields.

### Multi-placement semantics

**"Linking"** an article into a second KB (`kb.linkArticles` tRPC →
`link-articles-into-kb.ts`) materializes a new `ArticlePlacement` row for an
existing `page` article (categories/folders can't be linked); it stamps
`linkedFromSourceId` from the article's own `sourceId` if present. This is the
**general multi-home mechanism** — used for hand-authored articles and by
Knowledge Sources alike, distinguished only by whether `linkedFromSourceId` is
set. Sources didn't get unified with a separate mechanism after the fact;
`ArticlePlacement` was introduced as part of the Sources refactor and doubles
as the general primitive.

**Publishing is per-placement, not shared.** `publishArticle` snapshots a new
`ArticleRevision` from the canonical draft only if that specific placement is
stale (`hasUnpublishedChanges || publishedRevisionId === null`); a placement
whose published copy is already current just flips `isPublished=true`.
Publishing one placement does **not** revalidate or affect other KBs the same
article is also placed into.

### Embeddings tables

| Table | File | Role |
| --- | --- | --- |
| `Dataset` | `dataset.ts` | A KB's managed embedding store (`isManaged = true`, hidden from the datasets UI). `embeddingModel` = `"provider:model"`, `vectorDimension`, `chunkSettings`, `searchConfig`. |
| `Document` | `document.ts` | One row **per article**, in the article's **home KB's** Dataset. `metadata.kb = { articleId, contentHash }` tracks sync state; `enabled` flips false when an article is unpublished or `aiEnabled=false`. |
| `DocumentSegment` | `document-segment.ts` | Chunk of a Document. Multi-dim vector columns (`embedding_512…3072`) each with its own HNSW cosine index (partial: `enabled AND indexStatus='INDEXED'`), plus a generated `searchVector` tsvector for BM25. |

**Search federation gap:** the schema comment on `homeKnowledgeBaseId`
promises that "search of any KB the article is placed into federates to [the
home] dataset." In practice `collectManagedDatasetIds`
(`search-knowledge.ts`) only implements this for **source-linked**
placements — it unions the KB's own dataset with datasets of any
`KnowledgeSource` reachable via `ArticlePlacement.linkedFromSourceId` in that
KB. Linking a **hand-authored** (non-source) article from KB-A into KB-B
leaves the new placement's `linkedFromSourceId` null, so `search_knowledge`
scoped to KB-B will not surface it — a real gap between the schema's stated
generality and the current retrieval code.

---

## 3. Service layer (`packages/lib/src/kb/`)

`KBService` (`kb-service.ts`) is a thin compatibility shim constructed as
`new KBService(db, organizationId)`; it delegates to per-concern modules.

- **KB ops** (`knowledge-base/`): `createKnowledgeBase` (+ `ensureManagedDataset`),
  `updateKnowledgeBase` (live fields), `updateDraftSettings`/`publishPendingSettings`/
  `discardSettingsDraft` (theme staging), `publishKnowledgeBase`, `deleteKnowledgeBase`.
- **Article ops** (`articles/`): reads `getArticles` / `getArticleById` /
  `getArticleBySlug` / `getArticleSlugPath`; writes `createArticle` (inserts
  Article + draft revision + one placement in a tx), `addPlacement`
  (idempotently adds a placement for an *existing* article into another KB),
  `linkArticlesIntoKb` (bulk `addPlacement` for chosen `page` articles),
  `detachArticle` (flips `Article.managed=false`, clears
  `linkedFromSourceId` on all placements), `updateArticleDraft` (mutates the
  shared draft revision, sets `hasUnpublishedChanges`), `updateArticleStructure`
  (slug/parentId/aiEnabled), `moveArticle` (reparents/reorders a *placement*),
  `updateArticlesBatch`, `deleteArticle`, `archiveArticle`/`unarchiveArticle`,
  `discardArticleDraft` (reverts the draft to the **home placement's**
  published baseline). **`publishArticle`** publishes one placement — snapshots
  the draft into a new numbered revision only if stale, repoints that
  placement's `publishedRevisionId`, clears its `hasUnpublishedChanges`
  (optional ancestor-chain cascade).
- **Versions & diff** (`articles/article-versions.ts`): list / restore /
  rename, plus `getArticleDiff` (resolves `draft`/`published`/revision-id
  sentinels, org-scoped) — the shared backend behind all three diff surfaces
  (§6).
- **Diff engine** (`blocks/`): `diffBlocks`/`diffBlockList` — pure, structural
  block diff keyed on stable `attrs.id` (LCS-ordered; classifies
  `added`/`removed`/`modified`/`moved`/`unchanged`; recurses into containers
  like tabs/accordion/table). `inline-diff.ts` — pure word-level diff via
  `fast-diff`, tokenized so edits land on word boundaries. `apply-patch.ts` —
  pure splice applying an `ArticlePatch`, the engine behind Kopilot's
  block-CRUD writes. All three are framework-free so `apps/web` client code
  can import them directly.
- **Markdown** (`markdown/`): `articleToMarkdown` ← `blocksToMd` (TipTap JSON →
  markdown, for AI prompts + `.md` export), `mdToBlocks` (reverse),
  `computeArticleJsonHash` (`hash.ts`, key-order-independent — the diff/CAS
  primitive), `stampIds`, `block-id.ts` (sequential `b<n>` allocator,
  high-water-mark).
- **Sync** (`kb-sync-service.ts` + `kb-sync-queue.ts`): `syncArticle` is
  idempotent — on publish, if `aiEnabled` and not a `link`, render to
  markdown, hash-skip if unchanged, upsert the Document in the **home KB's**
  Dataset, enqueue segment embedding (BullMQ, coalesced per-article jobId).
  Unpublish → disable Document; delete → drop it.
- **Realtime** (`realtime.ts`): publishes to Redis channel `kb:article:${articleId}`
  with events `kb-article-patch`, `kb-article-resync`, `kb-article-lock`.
- **Kopilot snapshot** (`kopilot-snapshot.ts`): pre-turn snapshot in Redis for
  the diff engine / turn review (see §6).
- Also: `article-tag-service.ts` (tag assignment), `draft-settings.ts`
  (`KBDraftSettings` shape + merge-over-live), `sync-article-denormalized-fields.ts`
  (recomputes `Article.title/excerpt/emoji/color` from the home placement).

Internal helpers (`internal/`) — `placement.ts` is the article/placement-split
abstraction layer (`resolvePlacement`, `toFlattenRow`, `loadPlacementRefs`);
`flatten-article.ts` builds the `ArticleListItem`/`ArticleEditorView` DTOs the
frontend consumes; `metadata-sync.ts` refreshes subtree slug paths on move.

---

## 4. Authoring editor (`apps/web`)

### Routes (`app/(protected)/app/kb/`)
- `/app/kb` — list view (`ArticlesView`, resource table).
- `/app/kb/[knowledgeBaseId]/editor/layout.tsx` — persistent `KBEditorFrame` chrome
  wrapped in `KnowledgeBaseProvider` (article-store survives navigation).
- `/app/kb/[knowledgeBaseId]/editor/[[...slug]]` — article editor pane. Slug
  convention uses a literal `~` separator for nested paths (`/editor/~/parent/child`).
- `/app/kb/[knowledgeBaseId]/preview` — published preview.

### Components (`apps/web/src/components/kb/`)
- **`KBEditorFrame`** (`ui/editor/kb-editor-frame.tsx`) — root chrome; reads `?panel=`
  to switch the left `KBTabPanel` between **General** (branding/colors), **Layout**
  (header/footer nav), and **Articles** (the tree). Mounts `KopilotContext` with
  `page='kb'` + `activeKnowledgeBaseId`.
- **`KBArticlesPanel`** (`ui/sidebar/`) — drag-reorder tree (`@dnd-kit`), create/delete/archive.
- **`KBEditorBody`** (`ui/editor/kb-editor-page-body.tsx`) — the pane swap
  point. Reads `?diff=` via `useDiffParam()` (`hooks/use-diff-param.ts`, nuqs);
  when set (`review` / `v:<revisionId>` / `kopilot`), renders
  `<ArticleDiffPane>` in place of `<ArticleEditor>`.
- **`ArticleEditor`** (`ui/editor/article-editor.tsx`) — right pane: header (title/emoji),
  cover/excerpt strip, the rich-text body, publish/status footer. Goes `readOnly` with
  an amber "Kopilot is editing" banner when a `kb-article-lock` arrives. Also
  renders the **Kopilot turn-review banner** (§6) when a pending snapshot exists.
- **`ArticleDiffPane` / `ArticleDiffView` / `article-diff-tree.ts`** — resolves
  the two sides for the current `?diff=` value and renders the diff (word-level
  inline highlight for modified blocks, colored borders for
  added/removed/moved, per-leaf diffs inside containers). Styled to match the
  TipTap editor, not the published site. Reused unmodified by all three diff
  entry points (§6).
- Dialogs: `article-settings-dialog` (slug/parent/kind/aiEnabled),
  `article-versions-dialog` (history + per-version "Diff" button that sets
  `?diff=v:<revisionId>`).

### Rich text — TipTap (`apps/web/src/components/editor/`)
Custom ProseMirror nodes replace StarterKit defaults:
- **`Block`** (`kb-article/block-node.ts`) — the workhorse: text, headings, lists,
  blockquote, code (Shiki-prehighlighted into attrs), callout (info/tip/warn/error/success),
  image, embed (YouTube/Vimeo/Figma/…).
- **`Panel` / `Tabs` / `Accordion`** — collapsible/tabbed containers (drag-reorder).
- **Table** — forked TipTap table extension with cell selection.
- Inline: marks, font/size/color, `@`-mention + reference picker, `/` slash commands,
  drag-drop image upload, KB-scoped link popover.
- Hooks: `useRichTextEditor` (generic node/extension setup) → `useKBArticleEditor`
  (adds KB slash + reference pickers) → `KBArticleEditor` (React wrapper, Cmd+S etc.).
- Shared renderer (`packages/ui/src/components/kb/article/`): `KBArticleRenderer`
  → `KBArticleNode` (extracted node-dispatch `switch`, shared with the diff
  view so the two never diverge) → `BlockRenderer` → `InlineRenderer`. No
  client hooks / no server-only imports → usable inside client components,
  which is what both the editor preview and `ArticleDiffView` rely on.

### Client state — Zustand (`components/kb/store/`)
- **`useArticleStore`** — article *metadata* + optimistic layer (pending updates,
  optimistic creates/deletes/moves). `selectEffectiveArticle` overlays optimistic onto
  server; mutations apply immediately, `confirmUpdate` on success, `rollbackUpdate` on error.
- **`useKnowledgeBaseStore`** — KB settings + optimistic draft-settings patches.
- **Content is fetched separately** via `useArticleContent` → `api.kb.getArticleById`
  (HTML + JSON, not in the store — keeps the store light and the editor from refetch churn).
  Also exposes `draftContentJson`/`publishedContentJson` so the pre-publish
  diff needs no extra roundtrip.
- Cross-tab sync: `useKbArticleChannel` subscribes to the SSE bridge of the Redis
  realtime channel. **`kb-article-patch` is a client stub** — it just invalidates and
  full-refetches (incremental client patch-apply was deliberately never built).
- Autosave: 1500ms debounce → `kb.updateArticleDraft` (writes both `content` +
  `contentJson`, emits `kb-article-resync` with `originatorSessionId` for echo suppression).

### tRPC (`apps/web/src/server/api/routers/kb.ts`)
KB: `byId`, `list`, `create`, `update`, `updateDraftSettings`,
`publishPendingSettings`, `discardSettingsDraft`, `publishSite`, `unpublishSite`, `delete`.
Article: `getArticles`, `getArticleById`, `getArticleBySlug`, `createArticle`,
`linkArticles` (materialize placements for existing articles into this KB),
`updateArticleDraft`, `updateArticleStructure`, `publishArticle`, `unpublishArticle`,
`archiveArticle`/`unarchiveArticle`, `discardArticleDraft`, `deleteArticle`, `moveArticle`,
`updateArticlesBatch`, `getArticleVersions`, `restoreArticleVersion`, `renameArticleVersion`,
`exportArticleMarkdown`, `getArticleDiff` (backend for all three diff surfaces),
`getKopilotTurnReview`/`keepKopilotTurn`/`revertKopilotTurn` (Kopilot turn
review — Keep/Undo, §6, **shipped and wired** into the editor banner).

---

## 5. Public reader site (`apps/kb`, port 3002)

Next.js 16 App Router, `output: 'standalone'`, `cacheComponents: true`. Shares the same
DB and packages (`@auxx/database`, `@auxx/lib`, `@auxx/ui`).

### Routing & resolution
- `/[orgSlug]/[kbSlug]/` — homepage (redirects to first navigable article).
- `/[orgSlug]/[kbSlug]/[...articleSlug]/` — article pages (nested slugs).
- `/[orgSlug]/[kbSlug]/search.json` — client search index (minisearch: titles,
  descriptions, headings, ~4KB body).
- `/_md/[orgSlug]/[kbSlug]/[...articleSlug]` — plain markdown export (rewritten
  from the public `.md`-suffixed URL via `proxy.ts`).
- `/r/[articleId]` — stable-id redirect. **Placement-aware**: queries
  `ArticlePlacement` by `articleId` ordered `desc(isPublished)` (prefers a
  published placement when an article is multi-homed), then walks that
  placement's `parentId` chain to build the slug path.
- `/api/revalidate` — Bearer-token tag revalidation webhook (`KB_REVALIDATE_SECRET`).
- `/auth/verify` — verifies an Ed25519 login token from the webapp, mints the
  `auxx-kb.session` cookie (Redis-backed, 24h) for INTERNAL KBs / custom domains.

KB resolved by `Organization.handle` + `KnowledgeBase.slug`, or by `customDomain`.

### Rendering & access
- Data loaders `loadKBPayload` / `loadKBPayloadWithContent` (`src/server/kb-data.ts`)
  query `ArticlePlacement` (joined to `Article` + the revision it points to via
  `publishedRevisionId`) filtered by `knowledgeBaseId`, `isPublished=true`,
  `Article.archivedAt IS NULL` — **not** `Article.parentId`/`Article.publishedRevisionId`
  (those don't exist on `Article` anymore). Because tree parentage lives in
  placement-id space, the loader remaps `parentPlacementId → articleId` so the
  returned list stays in article-id space and existing ancestor-chain subtree
  pruning works unchanged. Cover URLs resolved in a parallel fan-out.
- Renderer chain in `@auxx/ui/components/kb/article`: `KBArticleRenderer` →
  `KBArticleNode` → `BlockRenderer` (block JSON → HTML) → `InlineRenderer`
  (marks, links, `auxx://kb/article/{id}` stable links). `codeBlock` renders
  pre-highlighted HTML from attrs.
- Theming: `KBThemeProvider` builds CSS variables from KB columns (logos, light/dark color
  pairs, theme type clean/muted/gradient/bold, fonts, corner style, nav). `NoFlashModeScript`
  applies the mode cookie before paint.
- Caching: **PUBLIC** KBs use full RSC cache (`cacheLife('max')`) keyed by tags
  `kb:orgSlug/kbSlug` and `kb-article:orgSlug/kbSlug/slugPath`, revalidated on publish via
  the webhook. **INTERNAL** KBs are never cached (streamed, membership-checked per request).
  UNLISTED/INTERNAL get `robots: noindex`. **Revalidation is per-KB**: `publishArticle`
  fires `fireKBRevalidate` only for the target `knowledgeBaseId` — publishing
  a multi-homed article in KB-A does not revalidate KB-B's tags.

---

## 6. AI & Kopilot

### Retrieval for ticket/email answering
Every agent gets the `auxx:knowledge` toolset by default
(`packages/lib/src/agents/default-toolsets.ts`), which includes
**`search_knowledge`** (`ai/kopilot/capabilities/knowledge/tools/search-knowledge.ts`).
It hybrid-searches (vector + BM25, coordinated by `SearchService` →
`VectorSearchService`/`FullTextSearchService`/`HybridSearchService`) across KB articles
(via each KB's managed Dataset, plus any source-linked datasets — see the
federation gap in §2) and RAG datasets. Args: `query`, `source` (kb|rag|both),
`knowledgeBaseId?`, `datasetIds?`, `recordIds?`, `limit`. KB hits carry a `docSlug` so the
agent can cite `[Title](auxx://doc/<docSlug>)`; RAG hits are prose-only. This is the path
by which an answering agent grounds a reply in KB content.

### Editing articles from the editor (markdown-first block-CRUD)
`createKbCapabilities` (`ai/kopilot/capabilities/kb/index.ts`, `page='kb'`) exposes
exactly **4 write tools**, all markdown-first and addressed by stable block id
(the earlier 6-tool set including `update_block_text`/`update_block_attrs` was
consolidated and those files removed):
- Reads (free): `get_article`, `get_article_section`, `list_articles`,
  `resolve_block_by_heading`.
- Writes (commit straight to the draft, per-turn Undo): `insert_blocks(anchor, markdown)`,
  `replace_block(blockId, markdown)` (rewrite a block; markdown may expand to
  several blocks — the first keeps the id; empty markdown deletes),
  `delete_blocks(blockIds)`, `move_blocks(blockIds, anchor)`.

Anchors are `{at:'start'|'end'}`, `{at:'before'|'after', blockId}`,
`{at:'startOf'|'endOf', containerId}`. Markdown supports rich blocks via
fences (callout, tabs, accordion, cards, image, embed, table). A separate
**`createKbReadCapabilities`** (`page='__global__'`) exposes just `get_article`
+ `list_articles` everywhere, so an agent can read an `@`-mentioned article off
the KB surface.

### Turn lifecycle (de-hacked — the v2 rewrite)
Writes flow tool → `runBlockCrudOp` (`kb/tools/write-helpers.ts`) — the single
choke point for every write: reads the draft + its content hash, **CAS-checks**
an optional `expectedHash` tool arg against the live `preHash` (rejects with a
`stale_content:` error if stale — chained `postHash` → next call's
`expectedHash`), applies the patch via `apply-patch.ts`, persists via
`updateArticleDraft(..., { bypassSnapshotClear, suppressResyncEvent })`, emits
per-op `kb-article-patch`. The **first write of a turn** captures a
`KopilotPreTurnSnapshot` to Redis `kb:article:${id}:preturn` (24h) and emits
`kb-article-lock`.

Turn-end is no longer bolted onto the SSE route. `PageCapability` exposes a
proper **`lifecycle.onTurnEnd`** hook (`agent-framework/types.ts`); the
engine's `withTurnEnd` wrapper fires it exactly once per turn from inside its
own public entry points (`submitMessage`/`resume`) on `turn-completed` →
`'completed'` or `turn-error`/abnormal close → `'error'` — so **both** the
in-process SSE path and the BullMQ worker path (`process-agent-job.ts`, which
just calls `engine.submitMessage`/`engine.resume`) get the hook for free, with
no duck-typing and no per-surface wiring. `createKbCapabilities`'s
`onTurnEnd` resolves the active article via `findRef(sessionContext,
'article')`, reads the turn-scoped snapshot, and calls `finalizeKopilotKbTurn`
(release lock, keep snapshot for review) on success or `revertKopilotKbTurn`
(restore snapshot, unlock, clear — `expectedTurnId`-gated so a stale prior
turn can't roll back a later one) on failure.

### Kopilot turn review (Keep / Undo — shipped)
After a Kopilot turn that edited the article, `ArticleEditor` shows a banner
("Kopilot changed N block(s)") with **Keep** and **Undo** buttons, driven by
`use-kopilot-review.ts` wrapping `kb.getKopilotTurnReview` /
`kb.keepKopilotTurn` / `kb.revertKopilotTurn`. The banner shows only when a
pending snapshot exists and Kopilot isn't currently holding the write lock;
state is Redis-backed so it survives a page refresh. Undo relies on the
realtime `kb-article-resync` event to repaint the editor.

### One diff engine, three surfaces
Every version is an `ArticleRevision.contentJson`. Three "diffs" are the same
operation — `diffBlocks()` over two `contentJson` trees, rendered by one
`<ArticleDiffView>` (§4), wired three ways via `kb.getArticleDiff` and the
shared `?diff=` pane:
1. **Version history** — a past revision vs published (`?diff=v:<revisionId>`,
   from the versions dialog).
2. **Pre-publish review** — draft vs published (`?diff=review`, "Review
   changes" button in the publish cluster; no roundtrip, uses already-loaded
   `draftContentJson`/`publishedContentJson`).
3. **Kopilot turn review** — pre-turn snapshot vs current draft
   (`?diff=kopilot`, from the review banner).

### How articles surface in assistant messages
- Inline citations: `[Title](auxx://doc/<docSlug>)` from search results.
- Entity fences: articles are entities, so `get_article`/`list_articles` results carry a
  `recordId` (`<entityDefinitionId>:<articleId>`) and the agent emits `auxx:entity-card`
  (one) or `auxx:entity-list` (many). There is no dedicated `auxx:kb-article` fence —
  entity fences cover it.

### SessionContext
`SessionRefKind` includes `'kb'` and `'article'`; `KopilotContext` sets `activeKnowledgeBaseId`/
`activeArticleId` (origin `'surface'`), and `@`-mentions add refs (origin `'mention'`, which
wins). Tools default their `articleId` from the active article ref when omitted.

---

## 7. End-to-end flows

**Author publishes an article**
`ArticleEditor` autosave → `kb.updateArticleDraft` (shared draft revision,
`hasUnpublishedChanges=true` on this placement, `kb-article-resync`) → user
clicks Publish → `kb.publishArticle` publishes **one placement** — snapshots
the draft into a new numbered `ArticleRevision` if stale, repoints that
placement's `publishedRevisionId` → `KBSyncService.syncArticle` (if
`aiEnabled`) upserts the Document in the article's **home KB** Dataset +
enqueues embeddings → `/api/revalidate` busts `apps/kb` cache tags for **that
KB only** → public page serves the new revision.

**Customer email answered from the KB**
Agent runs with `auxx:knowledge` → `search_knowledge` hybrid-searches managed Datasets + RAG →
ranked segments returned with `docSlug` → agent drafts a reply citing `auxx://doc/<docSlug>`.

**Kopilot edits the open article**
On `page='kb'` with an active article, agent calls `get_article` → block-CRUD
writes CAS-check and patch the shared draft (`applyPatch` →
`updateArticleDraft`), first write snapshots + locks the editor (read-only
banner) → on turn end, `onTurnEnd` finalizes (releases lock, keeps snapshot)
or reverts (restores snapshot) → a Keep/Undo review banner appears; Undo
restores the pre-turn snapshot and the editor full-refetches via the
`kb-article-patch` stub.

**Author links an article into a second KB**
`kb.linkArticles` → `linkArticlesIntoKb` → `addPlacement` materializes a new
`ArticlePlacement` for the existing article under a chosen parent in the
target KB, stamping `linkedFromSourceId` from the article's own `sourceId` if
it came from a Knowledge Source. Content is shared (one draft, one home
Dataset); publish state and tree position are independent per placement.

---

## 8. Key file index

| Concern | Path |
| --- | --- |
| Schema | `packages/database/src/db/schema/{knowledge-base,article,article-placement,article-revision,dataset,document,document-segment,knowledge-source}.ts` |
| Service | `packages/lib/src/kb/` (`kb-service.ts`, `articles/`, `knowledge-base/`, `blocks/`, `markdown/`, `internal/`, `kb-sync-service.ts`, `realtime.ts`, `kopilot-snapshot.ts`, `article-tag-service.ts`, `draft-settings.ts`, `sync-article-denormalized-fields.ts`) |
| Editor UI | `apps/web/src/components/kb/` (`ui/editor/`, `ui/sidebar/`, `store/`, `hooks/`) |
| Diff UI | `apps/web/src/components/kb/ui/editor/article-diff-{pane,view}.tsx`, `article-diff-tree.ts`, `hooks/use-diff-param.ts`, `hooks/use-kopilot-review.ts` |
| TipTap nodes | `apps/web/src/components/editor/kb-article/` |
| tRPC | `apps/web/src/server/api/routers/kb.ts` |
| Public site | `apps/kb/src/app/`, `apps/kb/src/server/{kb-data,kb-cache}.ts` |
| Renderer (shared) | `packages/ui/src/components/kb/article/` |
| Kopilot KB tools | `packages/lib/src/ai/kopilot/capabilities/kb/` (`index.ts`, `tools/`, `tools/write-helpers.ts`) |
| Kopilot search | `packages/lib/src/ai/kopilot/capabilities/knowledge/tools/search-knowledge.ts` |
| Embedding search | `packages/lib/src/datasets/services/search.service.ts`, `datasets/search/hybrid-search.ts` |
| Turn-end engine hook | `packages/lib/src/ai/agent-framework/types.ts` (`onTurnEnd`), `engine.ts` (`withTurnEnd`) |
| Knowledge Sources | `packages/lib/src/knowledge-sources/`, `docs/knowledge-sources-architecture-guide.md` |
