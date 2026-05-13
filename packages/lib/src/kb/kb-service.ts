// @auxx/lib/kb/kb-service.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { ArticleKind, ArticleStatus } from '@auxx/database/enums'
import type {
  ArticleKind as ArticleKindType,
  ArticleStatus as ArticleStatusType,
} from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { RecordId } from '@auxx/types/resource'
import { generateId, generateKeyBetween } from '@auxx/utils'
import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { DatasetService } from '../datasets/services/dataset-service'
import { batchGetArticleTagIds } from '../field-values/relationship-queries'
import type { KBDraftSettings } from './draft-settings'
import { enrichDocWithHighlighting } from './highlight-code'
import { enqueueKBSync } from './kb-sync-queue'
import { clearKopilotSnapshot } from './kopilot-snapshot'
import { computeArticleJsonHash } from './markdown/hash'
import { stampBlockIds } from './markdown/stamp-ids'
import type { ArticleNodeJSON } from './markdown/types'
import { publishKbArticleEvent } from './realtime'
import { syncArticleDenormalizedFields } from './sync-article-denormalized-fields'

// Local model types inferred from Drizzle schema
type KnowledgeBase = typeof schema.KnowledgeBase.$inferSelect
type ArticleRow = typeof schema.Article.$inferSelect
type ArticleRevision = typeof schema.ArticleRevision.$inferSelect
type KBPublishStatus = 'DRAFT' | 'PUBLISHED' | 'UNLISTED'

const logger = createScopedLogger('kb-service')

// ─── Public shapes (flattened) ───────────────────────────────────────────

/**
 * Lightweight metadata for a single revision (draft or published).
 * Keeps cover URLs resolved server-side so consumers don't need a follow-up
 * roundtrip per id.
 */
export interface ArticleRevisionMeta {
  title: string
  description: string | null
  excerpt: string | null
  emoji: string | null
  coverImage: string | null
  coverImageId: string | null
}

export interface ArticleListItem {
  id: string
  knowledgeBaseId: string
  organizationId: string
  slug: string
  parentId: string | null
  sortOrder: string
  articleKind: ArticleKindType
  isPublished: boolean
  aiEnabled: boolean
  status: ArticleStatusType
  hasUnpublishedChanges: boolean
  publishedAt: Date | null
  publishedRevisionId: string | null
  draftRevisionId: string | null
  // Display fields — derived from the draft revision (current working state).
  title: string
  emoji: string | null
  description: string | null
  excerpt: string | null
  coverImage: string | null
  /**
   * Per-revision envelopes so consumers (editor, preview) can read the
   * exact revision they need without an extra async fetch. `draft` is
   * always present (every article has a draft); `published` is null
   * until the article has been published at least once.
   */
  draft: ArticleRevisionMeta
  published: ArticleRevisionMeta | null
  /** Tag RecordIds (`entityDefinitionId:tagId`) attached to this article. */
  tagIds: RecordId[]
}

export interface ArticleEditorView extends ArticleListItem {
  // Always the draft fields, plus the heavy content
  content: string
  contentJson: ArticleNodeJSON[] | null
  /** Hash of `contentJson` — the editor uses it to dedupe inbound syncs. */
  draftContentHash: string
  coverImageId: string | null
  hasPublishedVersion: boolean
  publishedTitle: string | null
  publishedContent: string | null
  publishedContentJson: ArticleNodeJSON[] | null
  publishedCoverImage: string | null
  // Populated only when getArticleById is called with a versionNumber.
  selectedVersionNumber: number | null
  selectedTitle: string | null
  selectedDescription: string | null
  selectedExcerpt: string | null
  selectedEmoji: string | null
  selectedContent: string | null
  selectedContentJson: ArticleNodeJSON[] | null
  selectedContentHash: string | null
  selectedCoverImage: string | null
  selectedCoverImageId: string | null
}

// ─── KB / Article input shapes ───────────────────────────────────────────

export interface KBFields {
  name?: string
  slug?: string
  description?: string
  publishStatus?: KBPublishStatus
  visibility?: 'PUBLIC' | 'INTERNAL'
  customDomain?: string
  logoDark?: string
  logoLight?: string
  theme?: 'clean' | 'muted' | 'gradient' | 'bold'
  showMode?: boolean
  defaultMode?: 'light' | 'dark'
  primaryColorLight?: string
  primaryColorDark?: string
  tintColorLight?: string
  tintColorDark?: string
  infoColorLight?: string
  infoColorDark?: string
  successColorLight?: string
  successColorDark?: string
  warningColorLight?: string
  warningColorDark?: string
  dangerColorLight?: string
  dangerColorDark?: string
  fontFamily?: string
  iconsFamily?: 'solid' | 'regular' | 'light'
  cornerStyle?: 'rounded' | 'straight'
  sidebarListStyle?: 'default' | 'pill' | 'line'
  searchbarPosition?: 'center' | 'corner'
  headerEnabled?: boolean
  footerEnabled?: boolean
  headerNavigation?: Array<{ title: string; link: string }>
  footerNavigation?: Array<{ title: string; link: string }>
}

export interface KBCreateInput
  extends Required<Pick<KBFields, 'name' | 'slug'>>,
    Omit<KBFields, 'name' | 'slug'> {}

/**
 * Live-only update input. Settings that visitors care about (theme, colors,
 * navigation, etc.) live in the draft envelope and go through
 * {@link KBService.updateDraftSettings}.
 */
export interface KBLiveInput {
  slug?: string
  customDomain?: string | null
  visibility?: 'PUBLIC' | 'INTERNAL'
  publishStatus?: KBPublishStatus
}

export type KBUpdateInput = KBLiveInput

export interface ArticleCreateInput {
  title?: string
  description?: string | null
  slug?: string
  content?: string
  contentJson?: ArticleNodeJSON[] | null
  excerpt?: string | null
  emoji?: string | null
  coverImageId?: string | null
  articleKind?: ArticleKindType
  parentId?: string | null
}

export interface ArticleDraftFields {
  title?: string
  description?: string | null
  excerpt?: string | null
  emoji?: string | null
  content?: string
  contentJson?: ArticleNodeJSON[] | null
  coverImageId?: string | null
}

export interface ArticleStructureFields {
  slug?: string
  parentId?: string | null
  aiEnabled?: boolean
}

export interface MoveArticleInput {
  id: string
  parentId: string | null
  sortOrder?: string
  adjacentId?: string
  position?: 'before' | 'after'
}

export interface ArticleBatchUpdateItem {
  id: string
  updates: ArticleDraftFields & ArticleStructureFields
}

export interface ArticleListOptions {
  includeUnpublished?: boolean
}

// ─── Service ─────────────────────────────────────────────────────────────

export class KBService {
  private db: Database
  private readonly organizationId: string
  private _assetService: { getDownloadUrl: (id: string) => Promise<string | null> } | null = null
  constructor(db: Database, organizationId: string) {
    this.db = db
    this.organizationId = organizationId
  }

  /**
   * Lazily construct (and memoize) a MediaAssetService for resolving cover
   * image URLs. Imported dynamically so client-bundled call sites of the kb
   * module don't pull in server-only deps.
   */
  private async getAssetService() {
    if (this._assetService) return this._assetService
    const { MediaAssetService } = await import('../files/server')
    this._assetService = new MediaAssetService(this.organizationId, undefined, this.db)
    return this._assetService
  }

  /**
   * Resolve a cover MediaAsset id to a URL fresh on every read. Public assets
   * return their durable externalUrl; private assets return a freshly-signed
   * presigned URL. Returns null when the id is null/missing or the asset has
   * been deleted.
   */
  private async resolveCoverUrl(coverImageId: string | null | undefined): Promise<string | null> {
    if (!coverImageId) return null
    try {
      const assetService = await this.getAssetService()
      return await assetService.getDownloadUrl(coverImageId)
    } catch {
      return null
    }
  }

  /**
   * Batch-resolve cover URLs for a list of ids. De-duplicates ids and returns
   * a Map keyed by id so a single asset shared across draft+published renders
   * to one resolution.
   */
  private async resolveCoverUrls(
    ids: Array<string | null | undefined>
  ): Promise<Map<string, string | null>> {
    const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
    const entries = await Promise.all(
      unique.map(async (id) => [id, await this.resolveCoverUrl(id)] as const)
    )
    return new Map(entries)
  }

  // ─── KB CRUD ────────────────────────────────────────────────────────

  async getKnowledgeBaseById(id: string): Promise<KnowledgeBase> {
    try {
      const knowledgeBase = await this.db.query.KnowledgeBase.findFirst({
        where: and(
          eq(schema.KnowledgeBase.id, id),
          eq(schema.KnowledgeBase.organizationId, this.organizationId)
        ),
      })
      if (!knowledgeBase) throw this.createNotFoundError(`Knowledge base with ID '${id}' not found`)
      return knowledgeBase
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge base', { knowledgeBaseId: id })
    }
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    try {
      return await this.db.query.KnowledgeBase.findMany({
        where: eq(schema.KnowledgeBase.organizationId, this.organizationId),
        orderBy: asc(schema.KnowledgeBase.name),
      })
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge bases')
    }
  }

  async createKnowledgeBase(input: KBCreateInput, createdById: string): Promise<KnowledgeBase> {
    try {
      await this.validateSlugAvailability(input.slug)
      const knowledgeBase = await this.db.transaction(async (tx) => {
        const [kb] = await tx
          .insert(schema.KnowledgeBase)
          .values({
            ...input,
            organizationId: this.organizationId,
            createdById,
            updatedAt: new Date(),
          })
          .returning()
        return kb
      })
      // Best-effort: provision the managed dataset that holds article embeddings.
      // First article publish will retry if this fails.
      this.ensureManagedDataset(knowledgeBase, createdById).catch((error) => {
        logger.warn('Failed to provision managed dataset for new KB', {
          knowledgeBaseId: knowledgeBase.id,
          error: error instanceof Error ? error.message : error,
        })
      })
      return knowledgeBase
    } catch (error) {
      return this.handleError(error, 'Error creating knowledge base', { input })
    }
  }

  /**
   * Provision (or reuse) the managed dataset that backs this KB's embeddings.
   * Idempotent: returns the existing datasetId if it still resolves to a row,
   * otherwise creates a fresh `__kb:${kb.id}` dataset and writes it back to the
   * KnowledgeBase row.
   */
  async ensureManagedDataset(kb: KnowledgeBase, createdById: string): Promise<string> {
    if (kb.datasetId) {
      const existing = await this.db.query.Dataset.findFirst({
        where: and(
          eq(schema.Dataset.id, kb.datasetId),
          eq(schema.Dataset.organizationId, this.organizationId)
        ),
        columns: { id: true },
      })
      if (existing) return existing.id
    }

    const datasetService = new DatasetService(this.db)
    const dataset = await datasetService.create(this.organizationId, createdById, {
      name: `__kb:${kb.id}`,
      description: `Managed dataset for KB "${kb.name}"`,
      isManaged: true,
      chunkSettings: {
        strategy: 'FIXED_SIZE',
        size: 1024,
        overlap: 200,
        delimiter: '\n## ',
        preprocessing: {
          normalizeWhitespace: true,
          removeUrlsAndEmails: false,
        },
      },
    })

    await this.db
      .update(schema.KnowledgeBase)
      .set({ datasetId: dataset.id, updatedAt: new Date() })
      .where(eq(schema.KnowledgeBase.id, kb.id))

    return dataset.id
  }

  /**
   * Update live-only KB columns (URL slug, custom domain, visibility, publish
   * status). Draftable presentation fields go through {@link updateDraftSettings}.
   */
  async updateKnowledgeBase(id: string, data: KBLiveInput): Promise<KnowledgeBase> {
    try {
      const existingKb = await this.verifyKnowledgeBaseExists(id)
      if (data.slug && data.slug !== existingKb.slug) {
        await this.validateSlugAvailability(data.slug, id)
      }
      const [updatedKb] = await this.db
        .update(schema.KnowledgeBase)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updatedKb
    } catch (error) {
      return this.handleError(error, 'Error updating knowledge base', { id, data })
    }
  }

  /**
   * Shallow-merge `patch` into the KB's `draftSettings` JSON. Never touches
   * flat columns. Public visitors continue to see whatever's on the row.
   */
  async updateDraftSettings(id: string, patch: KBDraftSettings): Promise<KnowledgeBase> {
    try {
      if (Object.keys(patch).length === 0) {
        return await this.verifyKnowledgeBaseExists(id)
      }
      const existing = await this.verifyKnowledgeBaseExists(id)
      const nextDraft: KBDraftSettings = {
        ...((existing.draftSettings as KBDraftSettings | null) ?? {}),
        ...patch,
      }
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ draftSettings: nextDraft, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error updating KB draft settings', { id })
    }
  }

  /**
   * Apply pending `draftSettings` onto the live columns and clear the JSON.
   * No-op if there's no pending draft.
   */
  async publishPendingSettings(id: string): Promise<KnowledgeBase> {
    try {
      const kb = await this.verifyKnowledgeBaseExists(id)
      const draft = kb.draftSettings as KBDraftSettings | null
      if (!draft || Object.keys(draft).length === 0) return kb
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ ...draft, draftSettings: null, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error publishing KB draft settings', { id })
    }
  }

  /** Drop the pending draft. Live columns are untouched. */
  async discardSettingsDraft(id: string): Promise<KnowledgeBase> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ draftSettings: null, updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error discarding KB draft settings', { id })
    }
  }

  async deleteKnowledgeBase(id: string): Promise<{ success: boolean }> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      await this.db.delete(schema.KnowledgeBase).where(eq(schema.KnowledgeBase.id, id))
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error deleting knowledge base', { knowledgeBaseId: id })
    }
  }

  /**
   * Toggle KB publish state. Updates publishedAt the first time it goes live;
   * lastPublishedAt every time it transitions to PUBLISHED/UNLISTED. Also
   * flushes any pending settings draft onto the live row in the same write,
   * so "Publish site" ships pending presentation changes too.
   */
  async publishKnowledgeBase(id: string, status: 'PUBLISHED' | 'UNLISTED'): Promise<KnowledgeBase> {
    try {
      const kb = await this.verifyKnowledgeBaseExists(id)
      const draft = kb.draftSettings as KBDraftSettings | null
      const now = new Date()
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({
          ...(draft ?? {}),
          draftSettings: null,
          publishStatus: status,
          publishedAt: kb.publishedAt ?? now,
          lastPublishedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error publishing knowledge base', { id, status })
    }
  }

  async unpublishKnowledgeBase(id: string): Promise<KnowledgeBase> {
    try {
      await this.verifyKnowledgeBaseExists(id)
      const [updated] = await this.db
        .update(schema.KnowledgeBase)
        .set({ publishStatus: 'DRAFT', updatedAt: new Date() })
        .where(eq(schema.KnowledgeBase.id, id))
        .returning()
      return updated
    } catch (error) {
      return this.handleError(error, 'Error unpublishing knowledge base', { id })
    }
  }

  // ─── Article reads ──────────────────────────────────────────────────

  /**
   * List articles for a KB. Each row's title/emoji/etc. is sourced from the
   * published revision when available, falling back to the draft revision
   * (so unpublished articles still show their authoring title in the sidebar).
   */
  async getArticles(
    knowledgeBaseId: string,
    options: ArticleListOptions = {}
  ): Promise<ArticleListItem[]> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      const articles = await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId),
          options.includeUnpublished ? undefined : eq(schema.Article.isPublished, true)
        ),
        orderBy: [asc(schema.Article.parentId), asc(schema.Article.sortOrder)],
        with: { publishedRevision: true, draftRevision: true },
      })
      const tagIdMap = await batchGetArticleTagIds(
        this.db,
        articles.map((a) => a.id),
        this.organizationId
      )
      // Batch-resolve every cover URL in one parallel fan-out so an N-article
      // KB makes O(unique-asset-count) round-trips, not O(N). resolveCoverUrls
      // de-dupes by id, so passing draft + published per article costs nothing
      // when they share the same asset (the common case).
      const urlMap = await this.resolveCoverUrls(
        articles.flatMap((a) => this.coverIdsForArticle(a))
      )
      return await Promise.all(
        articles.map((a) =>
          this.flattenForList(a, (tagIdMap.get(a.id) ?? []) as RecordId[], urlMap)
        )
      )
    } catch (error) {
      return this.handleError(error, 'Error fetching knowledge base articles', { knowledgeBaseId })
    }
  }

  /**
   * Editor view: returns the article with its draft revision content + a hint
   * of the published revision content for "discard draft" previews. Pass
   * `versionNumber` to additionally include the content of an immutable
   * historical revision in the `selected*` fields.
   */
  async getArticleById(
    id: string,
    knowledgeBaseId?: string,
    versionNumber?: number
  ): Promise<ArticleEditorView> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId),
          knowledgeBaseId ? eq(schema.Article.knowledgeBaseId, knowledgeBaseId) : undefined
        ),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      let selected: ArticleRevision | null = null
      if (versionNumber !== undefined) {
        const revision = await this.db.query.ArticleRevision.findFirst({
          where: and(
            eq(schema.ArticleRevision.articleId, id),
            eq(schema.ArticleRevision.organizationId, this.organizationId),
            eq(schema.ArticleRevision.versionNumber, versionNumber)
          ),
        })
        if (!revision) {
          throw this.createNotFoundError(`Version ${versionNumber} not found for article '${id}'`)
        }
        selected = revision
      }
      const tagIds = await this.loadArticleTagRecordIds(id)
      return await this.flattenForEditor(article, selected, tagIds)
    } catch (error) {
      return this.handleError(error, 'Error fetching article', { articleId: id })
    }
  }

  async getArticleBySlug(slug: string, knowledgeBaseId: string): Promise<ArticleEditorView> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.slug, slug),
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with slug '${slug}' not found`)
      const tagIds = await this.loadArticleTagRecordIds(article.id)
      return await this.flattenForEditor(article, null, tagIds)
    } catch (error) {
      return this.handleError(error, 'Error fetching article by slug', { slug, knowledgeBaseId })
    }
  }

  /**
   * Resolve the slash-joined slug path of an article by walking parentId.
   * Used for surgical revalidation of the public site.
   */
  async getArticleSlugPath(articleId: string): Promise<string | undefined> {
    try {
      const path: string[] = []
      let cursor: { id: string; slug: string; parentId: string | null } | undefined =
        await this.db.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, articleId),
            eq(schema.Article.organizationId, this.organizationId)
          ),
          columns: { id: true, slug: true, parentId: true },
        })
      if (!cursor) return undefined
      while (cursor) {
        path.unshift(cursor.slug)
        if (!cursor.parentId) break
        cursor = await this.db.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, cursor.parentId),
            eq(schema.Article.organizationId, this.organizationId)
          ),
          columns: { id: true, slug: true, parentId: true },
        })
      }
      return path.join('/')
    } catch (error) {
      logger.warn('failed to resolve slug path', { articleId, error })
      return undefined
    }
  }

  // ─── Article writes ─────────────────────────────────────────────────

  /**
   * Create a new article + its initial draft revision in one transaction.
   */
  async createArticle(
    knowledgeBaseId: string,
    input: ArticleCreateInput,
    authorId: string,
    orderInfo?: { adjacentId: string; position: 'before' | 'after' }
  ): Promise<ArticleListItem> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      const articleInput = { ...input }
      const kind: ArticleKindType = articleInput.articleKind ?? ArticleKind.page
      articleInput.articleKind = kind
      if (kind === ArticleKind.link) {
        // Title and URL are independent for links. Slug carries the URL —
        // empty URLs get a unique placeholder so the unique constraint
        // doesn't bite when a user creates several empty links in a row.
        if (!articleInput.title || articleInput.title.trim() === '') {
          const n = await this.findNextPageNumber(knowledgeBaseId)
          articleInput.title = `Link ${n}`
        }
        if (!articleInput.slug || articleInput.slug.trim() === '') {
          articleInput.slug = `link-${generateId()}`
        }
      } else if (!articleInput.title || articleInput.title.trim() === '') {
        const nextPageNumber = await this.findNextPageNumber(knowledgeBaseId)
        articleInput.title = `Page ${nextPageNumber}`
        articleInput.slug = `page-${nextPageNumber}`
      } else if (!articleInput.slug || articleInput.slug.trim() === '') {
        articleInput.slug = await this.generateUniqueSlugFromTitle(
          articleInput.title,
          knowledgeBaseId
        )
      }
      await this.validateArticleSlugAvailability(articleInput.slug!, knowledgeBaseId)
      const parent = articleInput.parentId
        ? await this.verifyParentArticleExists(articleInput.parentId, knowledgeBaseId)
        : null
      this.validateArticleKind(kind, parent)
      let sortOrder: string
      if (orderInfo) {
        const adjacent = await this.db.query.Article.findFirst({
          where: eq(schema.Article.id, orderInfo.adjacentId),
          columns: { sortOrder: true, parentId: true },
        })
        if (!adjacent) {
          sortOrder = await this.getNextArticleSortOrder(
            knowledgeBaseId,
            articleInput.parentId ?? null
          )
        } else {
          if (articleInput.parentId === undefined) articleInput.parentId = adjacent.parentId
          const targetParentId = articleInput.parentId ?? null
          const siblings = await this.db.query.Article.findMany({
            where: and(
              eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
              targetParentId === null
                ? isNull(schema.Article.parentId)
                : eq(schema.Article.parentId, targetParentId)
            ),
            orderBy: asc(schema.Article.sortOrder),
            columns: { id: true, sortOrder: true },
          })
          const idx = siblings.findIndex((s) => s.id === orderInfo.adjacentId)
          const before = orderInfo.position === 'before'
          const lo = before ? (siblings[idx - 1]?.sortOrder ?? null) : adjacent.sortOrder
          const hi = before ? adjacent.sortOrder : (siblings[idx + 1]?.sortOrder ?? null)
          sortOrder = generateKeyBetween(lo, hi)
        }
      } else {
        sortOrder = await this.getNextArticleSortOrder(
          knowledgeBaseId,
          articleInput.parentId ?? null
        )
      }

      const seededContentJson = articleInput.contentJson
        ? stampBlockIds(articleInput.contentJson).content
        : null

      const result = await this.db.transaction(async (tx) => {
        // 1. Insert Article with NULL revision pointers (FKs are nullable)
        const [newArticle] = await tx
          .insert(schema.Article)
          .values({
            slug: articleInput.slug || '',
            articleKind: kind,
            parentId: articleInput.parentId ?? null,
            isPublished: false,
            status: ArticleStatus.DRAFT,
            sortOrder,
            knowledgeBaseId,
            organizationId: this.organizationId,
            authorId,
            updatedAt: new Date(),
            hasUnpublishedChanges: false,
          })
          .returning()

        // 2. Insert the initial draft revision
        const [newRevision] = await tx
          .insert(schema.ArticleRevision)
          .values({
            articleId: newArticle.id,
            organizationId: this.organizationId,
            versionNumber: null,
            title: articleInput.title || '',
            description: articleInput.description ?? null,
            excerpt: articleInput.excerpt ?? null,
            emoji: articleInput.emoji ?? null,
            content: articleInput.content ?? '',
            contentJson: seededContentJson,
            coverImageId: articleInput.coverImageId ?? null,
            editorId: authorId,
          })
          .returning()

        // 3. Wire the pointer
        const [withPointer] = await tx
          .update(schema.Article)
          .set({ draftRevisionId: newRevision.id })
          .where(eq(schema.Article.id, newArticle.id))
          .returning()
        await syncArticleDenormalizedFields(newArticle.id, tx)
        return { article: withPointer, draftRevision: newRevision }
      })

      return await this.flattenForList({
        ...result.article,
        publishedRevision: null,
        draftRevision: result.draftRevision,
      })
    } catch (error) {
      return this.handleError(error, 'Error creating article', { input, knowledgeBaseId })
    }
  }

  /**
   * Update the draft revision row in place. Marks the article as having
   * unpublished changes. Does not write any structural fields.
   *
   * `options.bypassSnapshotClear` — used by Kopilot's own writes so they
   * don't wipe the pre-turn snapshot they just captured. Default false:
   * any other write path (manual save, restore, etc.) clears the
   * snapshot so a stale Undo button greys out.
   *
   * `options.suppressResyncEvent` — Kopilot writes publish a finer
   * `kb-article-patch` event of their own; suppress the broad resync.
   */
  async updateArticleDraft(
    id: string,
    fields: ArticleDraftFields,
    editorId: string,
    knowledgeBaseId?: string,
    options: {
      bypassSnapshotClear?: boolean
      suppressResyncEvent?: boolean
      originatorSessionId?: string
    } = {}
  ): Promise<ArticleEditorView> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      if (!article.draftRevisionId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Article has no draft revision',
        })
      }

      const draftUpdate: Partial<ArticleRevision> = {
        editorId,
        updatedAt: new Date(),
      }
      if (fields.title !== undefined) draftUpdate.title = fields.title
      if (fields.description !== undefined) draftUpdate.description = fields.description
      if (fields.excerpt !== undefined) draftUpdate.excerpt = fields.excerpt
      if (fields.emoji !== undefined) draftUpdate.emoji = fields.emoji
      if (fields.content !== undefined) draftUpdate.content = fields.content
      if (fields.contentJson !== undefined) {
        const stamped = fields.contentJson ? stampBlockIds(fields.contentJson).content : null
        const enriched = stamped ? await enrichDocWithHighlighting(stamped) : null
        draftUpdate.contentJson = enriched as ArticleRevision['contentJson']
      }
      if (fields.coverImageId !== undefined) draftUpdate.coverImageId = fields.coverImageId

      const updated = await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ArticleRevision)
          .set(draftUpdate)
          .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
        const [next] = await tx
          .update(schema.Article)
          .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
          .returning()
        await syncArticleDenormalizedFields(id, tx)
        return next
      })

      // Manual edit invalidates any pending Kopilot pre-turn snapshot —
      // the user has accepted/diverged from whatever state the agent
      // was reasoning against, so its Undo affordance no longer makes
      // sense. Skipped for Kopilot's own writes (the agent captured the
      // snapshot before its first op and we want to keep it).
      if (!options.bypassSnapshotClear) {
        void clearKopilotSnapshot(id)
      }

      // Reload with revisions to flatten
      const reloaded = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, id),
        with: { publishedRevision: true, draftRevision: true },
      })
      const tagIds = await this.loadArticleTagRecordIds(id)

      // Realtime push: any subscribed editor swaps to the fresh doc on
      // receipt. Manual saves use `resync` (full doc) rather than
      // `patch` because we don't track the per-edit shape on this path.
      // Kopilot writes publish their own kb-article-patch and suppress
      // this broader resync.
      if (fields.contentJson !== undefined && !options.suppressResyncEvent) {
        const draftJson = (reloaded?.draftRevision?.contentJson ?? null) as ArticleNodeJSON[] | null
        if (draftJson) {
          void publishKbArticleEvent(id, {
            type: 'kb-article-resync',
            articleId: id,
            contentJson: draftJson,
            contentHash: computeArticleJsonHash(draftJson),
            cause: { kind: 'manual' },
            originatorSessionId: options.originatorSessionId,
          })
        }
      }

      // Return the editor-shaped view (content + contentJson + draftContentHash)
      // so the client's optimistic `setData` merge can refresh the cached doc.
      // Without these fields the cache keeps the load-time content, and a
      // navigate-away-and-back within the query staleTime renders stale content.
      if (!reloaded) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Article ${id} disappeared during update`,
        })
      }
      return await this.flattenForEditor(reloaded, null, tagIds)
    } catch (error) {
      return this.handleError(error, 'Error updating article draft', { articleId: id })
    }
  }

  /**
   * Mutate structural fields (slug, parent, order). Stays on the Article row —
   * no revision side-effects. `articleKind` is immutable post-create.
   */
  async updateArticleStructure(
    id: string,
    fields: ArticleStructureFields,
    knowledgeBaseId?: string
  ): Promise<ArticleListItem> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      if (fields.slug && fields.slug !== article.slug) {
        await this.validateArticleSlugAvailability(fields.slug, article.knowledgeBaseId, id)
      }
      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (fields.slug !== undefined) updateData.slug = fields.slug
      if (fields.parentId !== undefined) updateData.parentId = fields.parentId
      const aiEnabledChanged =
        fields.aiEnabled !== undefined && fields.aiEnabled !== article.aiEnabled
      if (fields.aiEnabled !== undefined) updateData.aiEnabled = fields.aiEnabled
      // For link kind, the slug *is* the URL — surface a URL change as an
      // unpublished diff so the publish UI prompts the user to re-publish.
      if (
        article.articleKind === ArticleKind.link &&
        fields.slug !== undefined &&
        fields.slug !== article.slug &&
        article.isPublished
      ) {
        updateData.hasUnpublishedChanges = true
      }

      await this.db.update(schema.Article).set(updateData).where(eq(schema.Article.id, id))

      const reloaded = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, id),
        with: { publishedRevision: true, draftRevision: true },
      })
      if (!reloaded) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      // Slug or parent changes shift the slugPath of the entire subtree, so
      // every published descendant's indexed segment metadata also needs a
      // refresh. Otherwise kopilot citations deep-link to the old URL.
      const slugChanged = fields.slug !== undefined && fields.slug !== article.slug
      const parentChanged = fields.parentId !== undefined && fields.parentId !== article.parentId
      if (slugChanged || parentChanged) {
        this.enqueueSubtreeMetadataSync(id, article.knowledgeBaseId, article.isPublished)
      }
      // AI toggle is the second indexing gate alongside isPublished. Drafts are
      // never indexed, so unpublished rows just persist the flag silently.
      if (aiEnabledChanged && article.isPublished) {
        void enqueueKBSync({
          type: fields.aiEnabled ? 'sync' : 'unpublish',
          articleId: id,
          kbId: article.knowledgeBaseId,
          organizationId: this.organizationId,
        })
      }
      const tagIds = await this.loadArticleTagRecordIds(id)
      return await this.flattenForList(reloaded, tagIds)
    } catch (error) {
      return this.handleError(error, 'Error updating article structure', { articleId: id })
    }
  }

  /**
   * Batch tree mutations (reorder + parent). Used by drag-and-drop.
   */
  async updateArticlesBatch(
    knowledgeBaseId: string,
    articles: ArticleBatchUpdateItem[]
  ): Promise<ArticleListItem[]> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      const reloadedArticles = await this.db.transaction(async (tx) => {
        const out: Array<NonNullable<Awaited<ReturnType<typeof tx.query.Article.findFirst>>>> = []
        for (const { id, updates } of articles) {
          const existing = await tx.query.Article.findFirst({
            where: and(
              eq(schema.Article.id, id),
              eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
              eq(schema.Article.organizationId, this.organizationId)
            ),
          })
          if (!existing) {
            logger.warn(`Article ${id} not found in KB ${knowledgeBaseId}`)
            continue
          }
          const cleaned: Record<string, unknown> = { updatedAt: new Date() }
          for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined && ['slug', 'parentId'].includes(key)) {
              cleaned[key] = value
            }
          }
          await tx.update(schema.Article).set(cleaned).where(eq(schema.Article.id, id))
          const reloaded = await tx.query.Article.findFirst({
            where: eq(schema.Article.id, id),
            with: { publishedRevision: true, draftRevision: true },
          })
          if (reloaded) {
            out.push(reloaded)
            const slugChanged = cleaned.slug !== undefined && cleaned.slug !== existing.slug
            const parentChanged =
              cleaned.parentId !== undefined && cleaned.parentId !== existing.parentId
            if (slugChanged || parentChanged) {
              this.enqueueSubtreeMetadataSync(id, reloaded.knowledgeBaseId, reloaded.isPublished)
            }
          }
        }
        return out
      })
      const tagIdMap = await batchGetArticleTagIds(
        this.db,
        reloadedArticles.map((a) => a.id),
        this.organizationId
      )
      const urlMap = await this.resolveCoverUrls(
        reloadedArticles.flatMap((a) => this.coverIdsForArticle(a))
      )
      return await Promise.all(
        reloadedArticles.map((a) =>
          this.flattenForList(a, (tagIdMap.get(a.id) ?? []) as RecordId[], urlMap)
        )
      )
    } catch (error) {
      return this.handleError(error, 'Error updating articles batch', {
        knowledgeBaseId,
        articleCount: articles.length,
      })
    }
  }

  async deleteArticle(id: string, knowledgeBaseId?: string): Promise<{ success: boolean }> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { children: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (knowledgeBaseId && article.knowledgeBaseId !== knowledgeBaseId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Article does not belong to knowledge base with ID '${knowledgeBaseId}'`,
        })
      }
      const isContainerKind =
        article.articleKind === ArticleKind.header || article.articleKind === ArticleKind.tab
      if (!isContainerKind && article.children.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot delete an article with children. Please remove or reassign children first.',
        })
      }
      // Drop revision pointers first to avoid the circular FK blocking the cascade.
      // For containers (headers + tabs): promote direct children up to the
      // container's own parent — null for tabs, the enclosing tab/null for
      // headers — slotting new sortOrder strings into the gap between the
      // container's previous and next siblings so visual order is preserved.
      await this.db.transaction(async (tx) => {
        if (isContainerKind && article.children.length > 0) {
          const promotedParentId = article.parentId
          const siblings = await tx.query.Article.findMany({
            where: and(
              eq(schema.Article.organizationId, this.organizationId),
              eq(schema.Article.knowledgeBaseId, article.knowledgeBaseId),
              promotedParentId === null
                ? isNull(schema.Article.parentId)
                : eq(schema.Article.parentId, promotedParentId),
              ne(schema.Article.id, id)
            ),
            columns: { id: true, sortOrder: true },
            orderBy: asc(schema.Article.sortOrder),
          })
          const lo =
            siblings.filter((s) => s.sortOrder < article.sortOrder).at(-1)?.sortOrder ?? null
          const hi = siblings.find((s) => s.sortOrder > article.sortOrder)?.sortOrder ?? null

          const sortedChildren = [...article.children].sort((a, b) =>
            a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0
          )
          let prevKey = lo
          for (const child of sortedChildren) {
            const newKey = generateKeyBetween(prevKey, hi)
            await tx
              .update(schema.Article)
              .set({ parentId: promotedParentId, sortOrder: newKey, updatedAt: new Date() })
              .where(eq(schema.Article.id, child.id))
            prevKey = newKey
          }
        }

        await tx
          .update(schema.Article)
          .set({ publishedRevisionId: null, draftRevisionId: null })
          .where(eq(schema.Article.id, id))
        await tx.delete(schema.Article).where(eq(schema.Article.id, id))
      })
      void enqueueKBSync({
        type: 'delete',
        articleId: id,
        kbId: article.knowledgeBaseId,
        organizationId: this.organizationId,
      })
      return { success: true }
    } catch (error) {
      return this.handleError(error, 'Error deleting article', { articleId: id })
    }
  }

  // ─── Publish state transitions ──────────────────────────────────────

  /**
   * Publish the article. If the draft has changes (or there is no published
   * revision yet), inserts a new ArticleRevision snapshot with the next
   * versionNumber and points the article at it. Otherwise just toggles
   * visibility back on (no new snapshot).
   *
   * `ancestorIds` opts into a cascade: each id is validated to be a DRAFT
   * ancestor of `id` on the parentId chain, then published in the same
   * transaction. Used to publish a tab/header alongside the leaf so the leaf
   * is visible on the public site.
   */
  async publishArticle(
    id: string,
    editorId: string,
    ancestorIds: string[] = []
  ): Promise<{ article: ArticleListItem; version: ArticleRevision | null }> {
    try {
      const result = await this.db.transaction(async (tx) => {
        if (ancestorIds.length > 0) {
          await this.validateAncestorChain(tx, id, ancestorIds)
        }

        const orderedIds = [...ancestorIds, id]
        const rows = await tx.query.Article.findMany({
          where: and(
            eq(schema.Article.organizationId, this.organizationId),
            inArray(schema.Article.id, orderedIds)
          ),
          with: { draftRevision: true },
        })
        const byId = new Map(rows.map((r) => [r.id, r]))

        let leafVersion: ArticleRevision | null = null
        for (const articleId of orderedIds) {
          const row = byId.get(articleId)
          if (!row) throw this.createNotFoundError(`Article with ID '${articleId}' not found`)
          if (!row.draftRevision) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Article ${articleId} has no draft revision to publish`,
            })
          }
          const version = await this.publishArticleInTx(tx, row, editorId)
          if (articleId === id) leafVersion = version
          await syncArticleDenormalizedFields(articleId, tx)
        }

        const [updated] = await tx.select().from(schema.Article).where(eq(schema.Article.id, id))
        return { article: updated, version: leafVersion }
      })

      const reloaded = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, id),
        with: { publishedRevision: true, draftRevision: true },
      })
      const tagIds = await this.loadArticleTagRecordIds(id)
      const flat = await this.flattenForList(
        reloaded ?? {
          ...result.article,
          publishedRevision: null,
          draftRevision: null,
        },
        tagIds
      )
      void enqueueKBSync({
        type: 'sync',
        articleId: id,
        kbId: flat.knowledgeBaseId,
        organizationId: this.organizationId,
      })
      void clearKopilotSnapshot(id)
      for (const ancestorId of ancestorIds) {
        void enqueueKBSync({
          type: 'sync',
          articleId: ancestorId,
          kbId: flat.knowledgeBaseId,
          organizationId: this.organizationId,
        })
        void clearKopilotSnapshot(ancestorId)
      }
      return { article: flat, version: result.version }
    } catch (error) {
      return this.handleError(error, 'Error publishing article', { articleId: id, ancestorIds })
    }
  }

  /**
   * Walk the org's article tree to confirm `ancestorIds` is exactly the set of
   * DRAFT ancestors of `leafId` walking up to the first PUBLISHED row. Throws
   * if any id is off-chain, ARCHIVED, already PUBLISHED, or if a DRAFT ancestor
   * is missing from the input.
   */
  private async validateAncestorChain(
    tx: Transaction,
    leafId: string,
    ancestorIds: string[]
  ): Promise<void> {
    const all = await tx.query.Article.findMany({
      where: eq(schema.Article.organizationId, this.organizationId),
      columns: { id: true, parentId: true, status: true, isPublished: true, title: true },
    })
    const byId = new Map(all.map((a) => [a.id, a]))
    if (!byId.has(leafId)) {
      throw this.createNotFoundError(`Article with ID '${leafId}' not found`)
    }

    const chainDrafts: string[] = []
    let cursor = byId.get(leafId)?.parentId ? byId.get(byId.get(leafId)!.parentId!) : undefined
    while (cursor) {
      if (cursor.status === ArticleStatus.ARCHIVED) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Ancestor '${cursor.title}' is archived. Unarchive it before publishing.`,
        })
      }
      if (cursor.status === ArticleStatus.PUBLISHED) break
      chainDrafts.push(cursor.id)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }

    const expected = new Set(chainDrafts)
    for (const id of ancestorIds) {
      if (!expected.has(id)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Ancestor ${id} is not on the publish chain.`,
        })
      }
    }
    for (const id of chainDrafts) {
      if (!ancestorIds.includes(id)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Missing ancestor ${id} from publish cascade.`,
        })
      }
    }
  }

  /**
   * Publish a single article row inside an existing transaction. Snapshots the
   * draft revision when needed, flips the article to PUBLISHED. Caller is
   * responsible for chain validation and downstream sync enqueue.
   */
  private async publishArticleInTx(
    tx: Transaction,
    article: ArticleRow & { draftRevision: ArticleRevision | null },
    editorId: string
  ): Promise<ArticleRevision | null> {
    const needsNewSnapshot = article.hasUnpublishedChanges || article.publishedRevisionId === null

    let newVersion: ArticleRevision | null = null
    let newPublishedRevisionId = article.publishedRevisionId

    if (needsNewSnapshot) {
      const [{ next }] = await tx
        .select({
          next: sql<number>`COALESCE(MAX(${schema.ArticleRevision.versionNumber}), 0) + 1`,
        })
        .from(schema.ArticleRevision)
        .where(eq(schema.ArticleRevision.articleId, article.id))
      const draft = article.draftRevision!
      const [inserted] = await tx
        .insert(schema.ArticleRevision)
        .values({
          articleId: article.id,
          organizationId: this.organizationId,
          versionNumber: next,
          title: draft.title,
          description: draft.description,
          excerpt: draft.excerpt,
          emoji: draft.emoji,
          content: draft.content,
          contentJson: draft.contentJson,
          coverImage: draft.coverImage,
          coverImageId: draft.coverImageId,
          editorId,
        })
        .returning()
      newVersion = inserted
      newPublishedRevisionId = inserted.id
    }

    const now = new Date()
    await tx
      .update(schema.Article)
      .set({
        publishedRevisionId: newPublishedRevisionId,
        isPublished: true,
        status: ArticleStatus.PUBLISHED,
        publishedAt: article.publishedAt ?? now,
        publishedById: editorId,
        hasUnpublishedChanges: false,
        updatedAt: now,
      })
      .where(eq(schema.Article.id, article.id))

    return newVersion
  }

  async unpublishArticle(id: string): Promise<ArticleListItem> {
    try {
      const article = await this.verifyArticleExists(id)
      await this.db
        .update(schema.Article)
        .set({
          isPublished: false,
          status: ArticleStatus.DRAFT,
          updatedAt: new Date(),
        })
        .where(eq(schema.Article.id, article.id))
      await syncArticleDenormalizedFields(id, this.db)
      void enqueueKBSync({
        type: 'unpublish',
        articleId: id,
        kbId: article.knowledgeBaseId,
        organizationId: this.organizationId,
      })
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error unpublishing article', { articleId: id })
    }
  }

  async archiveArticle(id: string): Promise<ArticleListItem> {
    try {
      const article = await this.verifyArticleExists(id)
      await this.db
        .update(schema.Article)
        .set({
          status: ArticleStatus.ARCHIVED,
          isPublished: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.Article.id, id))
      void enqueueKBSync({
        type: 'unpublish',
        articleId: id,
        kbId: article.knowledgeBaseId,
        organizationId: this.organizationId,
      })
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error archiving article', { articleId: id })
    }
  }

  async unarchiveArticle(id: string): Promise<ArticleListItem> {
    try {
      await this.verifyArticleExists(id)
      await this.db
        .update(schema.Article)
        .set({
          status: ArticleStatus.DRAFT,
          isPublished: false,
          updatedAt: new Date(),
        })
        .where(eq(schema.Article.id, id))
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error unarchiving article', { articleId: id })
    }
  }

  /**
   * Discard the current draft, copying the published revision's content
   * back into the draft revision row. No-op if there's no published version.
   */
  async discardArticleDraft(id: string): Promise<ArticleListItem> {
    try {
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, id),
          eq(schema.Article.organizationId, this.organizationId)
        ),
        with: { publishedRevision: true },
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
      if (!article.publishedRevision || !article.draftRevisionId) {
        // Nothing to discard back to; just clear the dirty flag for tidiness.
        await this.db
          .update(schema.Article)
          .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
        return await this.reloadFlat(id)
      }
      const pub = article.publishedRevision
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ArticleRevision)
          .set({
            title: pub.title,
            description: pub.description,
            excerpt: pub.excerpt,
            emoji: pub.emoji,
            content: pub.content,
            contentJson: pub.contentJson,
            coverImage: pub.coverImage,
            coverImageId: pub.coverImageId,
            updatedAt: new Date(),
          })
          .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
        await tx
          .update(schema.Article)
          .set({ hasUnpublishedChanges: false, updatedAt: new Date() })
          .where(eq(schema.Article.id, id))
        await syncArticleDenormalizedFields(id, tx)
      })
      void clearKopilotSnapshot(id)
      return await this.reloadFlat(id)
    } catch (error) {
      return this.handleError(error, 'Error discarding article draft', { articleId: id })
    }
  }

  /**
   * Restore a prior version into the draft revision (in-place). Marks the
   * article dirty so the user can preview before publishing.
   */
  async restoreArticleVersion(versionId: string, editorId: string): Promise<ArticleListItem> {
    try {
      const version = await this.db.query.ArticleRevision.findFirst({
        where: and(
          eq(schema.ArticleRevision.id, versionId),
          eq(schema.ArticleRevision.organizationId, this.organizationId)
        ),
      })
      if (!version) throw this.createNotFoundError(`Version with ID '${versionId}' not found`)
      if (version.versionNumber === null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot restore from a draft revision',
        })
      }
      const article = await this.db.query.Article.findFirst({
        where: eq(schema.Article.id, version.articleId),
      })
      if (!article || !article.draftRevisionId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Article has no draft revision',
        })
      }
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.ArticleRevision)
          .set({
            title: version.title,
            description: version.description,
            excerpt: version.excerpt,
            emoji: version.emoji,
            content: version.content,
            contentJson: version.contentJson,
            coverImage: version.coverImage,
            coverImageId: version.coverImageId,
            editorId,
            updatedAt: new Date(),
          })
          .where(eq(schema.ArticleRevision.id, article.draftRevisionId!))
        await tx
          .update(schema.Article)
          .set({ hasUnpublishedChanges: true, updatedAt: new Date() })
          .where(eq(schema.Article.id, article.id))
        await syncArticleDenormalizedFields(article.id, tx)
      })
      void clearKopilotSnapshot(article.id)
      return await this.reloadFlat(article.id)
    } catch (error) {
      return this.handleError(error, 'Error restoring article version', { versionId })
    }
  }

  /**
   * Reorder the tab strip. The KB root routes through the first tab, so this
   * also implicitly changes the landing article when index 0 changes.
   */
  /**
   * Move an article — change its parent and/or its position among siblings.
   * Single-row write; computes sortOrder via fractional indexing. Tabs are
   * just root articles (`parentId === null`, `articleKind === 'tab'`); they
   * use the same primitive.
   */
  async moveArticle(knowledgeBaseId: string, input: MoveArticleInput): Promise<ArticleListItem> {
    try {
      await this.verifyKnowledgeBaseExists(knowledgeBaseId)
      const article = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.id, input.id),
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId)
        ),
      })
      if (!article) throw this.createNotFoundError(`Article with ID '${input.id}' not found`)

      const parent = input.parentId
        ? await this.verifyParentArticleExists(input.parentId, knowledgeBaseId)
        : null
      this.validateArticleKind(article.articleKind, parent)

      let sortOrder: string
      if (input.sortOrder !== undefined) {
        sortOrder = input.sortOrder
      } else if (input.adjacentId && input.position) {
        const adjacent = await this.db.query.Article.findFirst({
          where: and(
            eq(schema.Article.id, input.adjacentId),
            eq(schema.Article.knowledgeBaseId, knowledgeBaseId)
          ),
          columns: { sortOrder: true, parentId: true },
        })
        if (!adjacent) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Adjacent article '${input.adjacentId}' not found`,
          })
        }
        const siblings = await this.db.query.Article.findMany({
          where: and(
            eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
            input.parentId === null
              ? isNull(schema.Article.parentId)
              : eq(schema.Article.parentId, input.parentId),
            ne(schema.Article.id, input.id)
          ),
          orderBy: asc(schema.Article.sortOrder),
          columns: { id: true, sortOrder: true },
        })
        const idx = siblings.findIndex((s) => s.id === input.adjacentId)
        const before = input.position === 'before'
        const lo = before ? (siblings[idx - 1]?.sortOrder ?? null) : adjacent.sortOrder
        const hi = before ? adjacent.sortOrder : (siblings[idx + 1]?.sortOrder ?? null)
        sortOrder = generateKeyBetween(lo, hi)
      } else {
        sortOrder = await this.getNextArticleSortOrder(knowledgeBaseId, input.parentId)
      }

      await this.db
        .update(schema.Article)
        .set({ parentId: input.parentId, sortOrder, updatedAt: new Date() })
        .where(eq(schema.Article.id, input.id))

      // Reparenting shifts the slugPath of the entire subtree — refresh
      // metadata for the moved node and every published descendant.
      if (article.parentId !== input.parentId) {
        this.enqueueSubtreeMetadataSync(input.id, knowledgeBaseId, article.isPublished)
      }

      return await this.reloadFlat(input.id)
    } catch (error) {
      return this.handleError(error, 'Error moving article', { input })
    }
  }

  // ─── Versions ───────────────────────────────────────────────────────

  async getArticleVersions(articleId: string) {
    try {
      await this.verifyArticleExists(articleId)
      return await this.db.query.ArticleRevision.findMany({
        where: and(
          eq(schema.ArticleRevision.articleId, articleId),
          eq(schema.ArticleRevision.organizationId, this.organizationId),
          sql`${schema.ArticleRevision.versionNumber} IS NOT NULL`
        ),
        orderBy: desc(schema.ArticleRevision.versionNumber),
        with: { editor: { columns: { id: true, name: true, image: true } } },
      })
    } catch (error) {
      return this.handleError(error, 'Error fetching article versions', { articleId })
    }
  }

  async renameArticleVersion(versionId: string, label: string | null): Promise<void> {
    try {
      await this.db
        .update(schema.ArticleRevision)
        .set({ label, updatedAt: new Date() })
        .where(
          and(
            eq(schema.ArticleRevision.id, versionId),
            eq(schema.ArticleRevision.organizationId, this.organizationId)
          )
        )
    } catch (error) {
      this.handleError(error, 'Error renaming article version', { versionId })
    }
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  /**
   * Cover ids touched by a single article — both draft and published.
   * Used to prime the batch URL map so a single fan-out resolves every
   * cover the list payload needs.
   */
  private coverIdsForArticle(a: any): Array<string | null | undefined> {
    return [a.draftRevision?.coverImageId, a.publishedRevision?.coverImageId]
  }

  /**
   * Build a per-revision envelope (title/emoji/cover…) used by both the
   * sidebar payload and the editor view so draft and published metadata
   * stay structurally identical.
   */
  private buildRevisionMeta(
    rev:
      | {
          title: string | null
          description: string | null
          excerpt: string | null
          emoji: string | null
          coverImageId: string | null
        }
      | null
      | undefined,
    urlMap?: Map<string, string | null>
  ): ArticleRevisionMeta | null {
    if (!rev) return null
    return {
      title: rev.title ?? '',
      description: rev.description ?? null,
      excerpt: rev.excerpt ?? null,
      emoji: rev.emoji ?? null,
      coverImageId: rev.coverImageId ?? null,
      coverImage: rev.coverImageId ? (urlMap?.get(rev.coverImageId) ?? null) : null,
    }
  }

  private async flattenForList(
    a: any,
    tagIds: RecordId[] = [],
    urlMap?: Map<string, string | null>
  ): Promise<ArticleListItem> {
    // resolveCoverUrls de-dupes by id, so passing both draft and published
    // (when present) costs nothing extra for the common case where they
    // share the same asset.
    const resolved = urlMap ?? (await this.resolveCoverUrls(this.coverIdsForArticle(a)))
    const draft = this.buildRevisionMeta(a.draftRevision, resolved) ?? {
      title: '',
      description: null,
      excerpt: null,
      emoji: null,
      coverImage: null,
      coverImageId: null,
    }
    const published = this.buildRevisionMeta(a.publishedRevision, resolved)
    return {
      id: a.id,
      knowledgeBaseId: a.knowledgeBaseId,
      organizationId: a.organizationId,
      slug: a.slug,
      parentId: a.parentId,
      sortOrder: a.sortOrder,
      articleKind: a.articleKind,
      isPublished: a.isPublished,
      aiEnabled: a.aiEnabled ?? true,
      status: a.status,
      hasUnpublishedChanges: a.hasUnpublishedChanges,
      publishedAt: a.publishedAt,
      publishedRevisionId: a.publishedRevisionId,
      draftRevisionId: a.draftRevisionId,
      // Sidebar reflects the current working state — always the draft.
      title: draft.title,
      emoji: draft.emoji,
      description: draft.description,
      excerpt: draft.excerpt,
      coverImage: draft.coverImage,
      draft,
      published,
      tagIds,
    }
  }

  private async flattenForEditor(
    a: any,
    selected: ArticleRevision | null = null,
    tagIds: RecordId[] = []
  ): Promise<ArticleEditorView> {
    const draft = a.draftRevision
    const pub = a.publishedRevision
    if (!draft) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Article ${a.id} has no draft revision`,
      })
    }
    const urlMap = await this.resolveCoverUrls([
      draft.coverImageId,
      pub?.coverImageId,
      selected?.coverImageId,
    ])
    const draftMeta = this.buildRevisionMeta(draft, urlMap)!
    const publishedMeta = this.buildRevisionMeta(pub, urlMap)
    return {
      id: a.id,
      knowledgeBaseId: a.knowledgeBaseId,
      organizationId: a.organizationId,
      slug: a.slug,
      parentId: a.parentId,
      sortOrder: a.sortOrder,
      articleKind: a.articleKind,
      isPublished: a.isPublished,
      aiEnabled: a.aiEnabled ?? true,
      status: a.status,
      hasUnpublishedChanges: a.hasUnpublishedChanges,
      publishedAt: a.publishedAt,
      publishedRevisionId: a.publishedRevisionId,
      draftRevisionId: a.draftRevisionId,
      title: draftMeta.title,
      emoji: draftMeta.emoji,
      description: draftMeta.description,
      excerpt: draftMeta.excerpt,
      coverImage: draftMeta.coverImage,
      coverImageId: draftMeta.coverImageId,
      draft: draftMeta,
      published: publishedMeta,
      tagIds,
      content: draft.content ?? '',
      contentJson: (draft.contentJson as ArticleNodeJSON[] | null) ?? null,
      draftContentHash: computeArticleJsonHash(
        (draft.contentJson as ArticleNodeJSON[] | null) ?? null
      ),
      hasPublishedVersion: !!pub,
      publishedTitle: pub?.title ?? null,
      publishedContent: pub?.content ?? null,
      publishedContentJson: (pub?.contentJson as ArticleNodeJSON[] | null) ?? null,
      publishedCoverImage: pub?.coverImageId ? (urlMap.get(pub.coverImageId) ?? null) : null,
      selectedVersionNumber: selected?.versionNumber ?? null,
      selectedTitle: selected?.title ?? null,
      selectedDescription: selected?.description ?? null,
      selectedExcerpt: selected?.excerpt ?? null,
      selectedEmoji: selected?.emoji ?? null,
      selectedContent: selected?.content ?? null,
      selectedContentJson: (selected?.contentJson as ArticleNodeJSON[] | null) ?? null,
      selectedContentHash: selected
        ? computeArticleJsonHash((selected.contentJson as ArticleNodeJSON[] | null) ?? null)
        : null,
      selectedCoverImage: selected?.coverImageId
        ? (urlMap.get(selected.coverImageId) ?? null)
        : null,
      selectedCoverImageId: selected?.coverImageId ?? null,
    }
  }

  private async reloadFlat(id: string): Promise<ArticleListItem> {
    const reloaded = await this.db.query.Article.findFirst({
      where: eq(schema.Article.id, id),
      with: { publishedRevision: true, draftRevision: true },
    })
    if (!reloaded) throw this.createNotFoundError(`Article with ID '${id}' not found`)
    const tagIds = await this.loadArticleTagRecordIds(id)
    return await this.flattenForList(reloaded, tagIds)
  }

  /**
   * Load article tag RecordIds (`tag:tagId`) for hydrating article reads.
   * Returns `[]` if the org doesn't yet have the tag entity definition seeded
   * (migration 018 hasn't run for this org).
   */
  private async loadArticleTagRecordIds(articleId: string): Promise<RecordId[]> {
    const map = await batchGetArticleTagIds(this.db, [articleId], this.organizationId)
    return (map.get(articleId) ?? []) as RecordId[]
  }

  private async findNextPageNumber(knowledgeBaseId: string): Promise<number> {
    try {
      // Pull every article for this KB along with its draft revision title so
      // we can scan for "Page N" titles and "page-N" slugs.
      const articles = await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.organizationId, this.organizationId),
          sql`${schema.Article.slug} like 'page-%'`
        ),
        columns: { slug: true },
        with: { draftRevision: { columns: { title: true } } },
      })
      if (articles.length === 0) return 1
      const numbers: number[] = []
      for (const article of articles) {
        const slugMatch = article.slug.match(/^page-(\d+)$/)
        if (slugMatch) numbers.push(parseInt(slugMatch[1], 10))
        const titleMatch = article.draftRevision?.title?.match(/^Page (\d+)$/)
        if (titleMatch) numbers.push(parseInt(titleMatch[1], 10))
      }
      return numbers.length > 0 ? Math.max(...numbers) + 1 : 1
    } catch (error) {
      logger.error('Error finding next page number', {
        knowledgeBaseId,
        organizationId: this.organizationId,
        error,
      })
      return 1
    }
  }

  private createNotFoundError(message: string): TRPCError {
    return new TRPCError({ code: 'NOT_FOUND', message })
  }

  private async verifyKnowledgeBaseExists(id: string): Promise<KnowledgeBase> {
    const knowledgeBase = await this.db.query.KnowledgeBase.findFirst({
      where: and(
        eq(schema.KnowledgeBase.id, id),
        eq(schema.KnowledgeBase.organizationId, this.organizationId)
      ),
    })
    if (!knowledgeBase) throw this.createNotFoundError(`Knowledge base with ID '${id}' not found`)
    return knowledgeBase
  }

  private async verifyArticleExists(id: string): Promise<ArticleRow> {
    const article = await this.db.query.Article.findFirst({
      where: and(eq(schema.Article.id, id), eq(schema.Article.organizationId, this.organizationId)),
    })
    if (!article) throw this.createNotFoundError(`Article with ID '${id}' not found`)
    return article
  }

  private async verifyParentArticleExists(
    parentId: string,
    knowledgeBaseId: string
  ): Promise<ArticleRow> {
    const parentExists = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, parentId),
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId)
      ),
    })
    if (!parentExists) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Parent article with ID '${parentId}' not found`,
      })
    }
    return parentExists
  }

  /**
   * Tabs are root-only. Tabs are optional: pages, categories, and headers may
   * sit at the KB root (`parent === null`) when no tabs exist. Headers may
   * only sit at the root or directly under a tab — never nested inside other
   * containers.
   */
  private validateArticleKind(kind: ArticleKindType, parent: ArticleRow | null): void {
    if (kind === ArticleKind.tab) {
      if (parent !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tabs are root-level only and cannot have a parent.',
        })
      }
      return
    }
    if (kind === ArticleKind.header && parent !== null && parent.articleKind !== ArticleKind.tab) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Section headers can only sit at the KB root or directly under a tab.',
      })
    }
  }

  private handleError(error: any, logMessage: string, context: Record<string, any> = {}): never {
    if (error instanceof TRPCError) throw error
    logger.error(logMessage, { error, organizationId: this.organizationId, ...context })
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: logMessage, cause: error })
  }

  private async validateSlugAvailability(slug: string, excludeId?: string): Promise<void> {
    const existingKb = await this.db.query.KnowledgeBase.findFirst({
      where: and(
        eq(schema.KnowledgeBase.organizationId, this.organizationId),
        eq(schema.KnowledgeBase.slug, slug),
        excludeId ? ne(schema.KnowledgeBase.id, excludeId) : undefined
      ),
      columns: { id: true },
    })
    if (existingKb) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A knowledge base with slug '${slug}' already exists`,
      })
    }
  }

  /**
   * Walk descendants of `rootId` (BFS over `parentId`, scoped to KB + org) and
   * collect the ids of every published descendant. Used to refresh indexed
   * segment metadata after a slugPath-shifting change.
   */
  private async getPublishedDescendantIds(
    rootId: string,
    knowledgeBaseId: string
  ): Promise<string[]> {
    const out: string[] = []
    let frontier: string[] = [rootId]
    while (frontier.length > 0) {
      const children = await this.db.query.Article.findMany({
        where: and(
          eq(schema.Article.organizationId, this.organizationId),
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          inArray(schema.Article.parentId, frontier)
        ),
        columns: { id: true, isPublished: true },
      })
      if (children.length === 0) break
      for (const child of children) {
        if (child.isPublished) out.push(child.id)
      }
      frontier = children.map((c) => c.id)
    }
    return out
  }

  /**
   * Enqueue metadata sync for the root (if published) and every published
   * descendant. Fire-and-forget — the BFS query happens on a microtask.
   */
  private enqueueSubtreeMetadataSync(
    rootId: string,
    knowledgeBaseId: string,
    rootIsPublished: boolean
  ): void {
    const enqueue = (articleId: string) => {
      void enqueueKBSync({
        type: 'metadata',
        articleId,
        kbId: knowledgeBaseId,
        organizationId: this.organizationId,
      })
    }
    if (rootIsPublished) enqueue(rootId)
    void this.getPublishedDescendantIds(rootId, knowledgeBaseId).then((ids) => {
      for (const id of ids) enqueue(id)
    })
  }

  private async validateArticleSlugAvailability(
    slug: string,
    knowledgeBaseId: string,
    excludeId?: string
  ): Promise<void> {
    const slugExists = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        eq(schema.Article.slug, slug),
        excludeId ? ne(schema.Article.id, excludeId) : undefined
      ),
    })
    if (slugExists) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `An article with slug '${slug}' already exists in this knowledge base`,
      })
    }
  }

  private async getNextArticleSortOrder(
    knowledgeBaseId: string,
    parentId: string | null
  ): Promise<string> {
    const last = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
        parentId === null ? isNull(schema.Article.parentId) : eq(schema.Article.parentId, parentId)
      ),
      orderBy: desc(schema.Article.sortOrder),
      columns: { sortOrder: true },
    })
    return generateKeyBetween(last?.sortOrder ?? null, null)
  }

  private async generateUniqueSlugFromTitle(
    title: string,
    knowledgeBaseId: string,
    excludeId?: string
  ): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '')
    let slug = baseSlug
    let counter = 1
    while (true) {
      const existing = await this.db.query.Article.findFirst({
        where: and(
          eq(schema.Article.knowledgeBaseId, knowledgeBaseId),
          eq(schema.Article.slug, slug),
          excludeId ? ne(schema.Article.id, excludeId) : undefined
        ),
      })
      if (!existing) return slug
      slug = `${baseSlug}-${counter}`
      counter++
    }
  }
}
