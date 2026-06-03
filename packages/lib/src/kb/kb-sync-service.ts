// packages/lib/src/kb/kb-sync-service.ts

import { createHash } from 'node:crypto'
import { type Database, schema } from '@auxx/database'
import { DocumentStatus, DocumentType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, sql } from 'drizzle-orm'
import { NullDocumentExecutionReporter } from '../datasets/events'
import { DocumentProcessor } from '../datasets/workers/document-processor'
import { KBService } from './kb-service'
import { articleToMarkdown } from './markdown/article-to-markdown'
import { computeContentHash } from './markdown/hash'
import type { ArticleNodeJSON } from './markdown/types'

const logger = createScopedLogger('kb-sync-service')

interface KBSyncServiceDeps {
  db: Database
  organizationId: string
}

/**
 * Bridges KB articles into the dataset embedding pipeline.
 *
 * One Document per Article, in the KB's managed Dataset. Re-publishes are
 * cheap (hash skip-check), unpublish flips `Document.enabled`, delete hard-
 * drops the Document and cascade-removes its segments.
 */
export class KBSyncService {
  private db: Database
  private organizationId: string

  constructor({ db, organizationId }: KBSyncServiceDeps) {
    this.db = db
    this.organizationId = organizationId
  }

  /**
   * Walk article → markdown → segments → embeddings. Idempotent and
   * hash-skipping: if the article's content hash matches what we last indexed,
   * just re-enables the Document and exits.
   */
  async syncArticle(articleId: string): Promise<void> {
    const article = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, articleId),
        eq(schema.Article.organizationId, this.organizationId)
      ),
      with: { draftRevision: true },
    })

    if (!article) {
      logger.warn('syncArticle: article not found', { articleId })
      return
    }

    // Link articles have no body to embed — they're external pointers, not
    // indexable content. Skip the dataset write.
    if (article.articleKind === 'link') {
      logger.info('syncArticle: link kind has no body, skipping', { articleId })
      return
    }

    // Content embeds once into the home KB's managed Dataset. Publish state is
    // per-placement; index when the home placement is published (behavior
    // parity with the pre-placement single-home model).
    const homePlacement = await this.db.query.ArticlePlacement.findFirst({
      where: and(
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
      ),
      with: { publishedRevision: true },
    })
    if (!homePlacement) {
      logger.warn('syncArticle: article has no home placement', { articleId })
      return
    }
    if (!homePlacement.isPublished) {
      logger.info('syncArticle: home placement not published, skipping', { articleId })
      return
    }

    // Self-heal: if a stale enqueue arrives after the AI toggle flipped off,
    // converge to a disabled Document just like the unpublish path.
    if (!article.aiEnabled) {
      logger.info('syncArticle: aiEnabled is false, ensuring document disabled', { articleId })
      const doc = await this.findArticleDocumentByArticleId(articleId)
      if (doc?.enabled) {
        await this.db
          .update(schema.Document)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(schema.Document.id, doc.id))
      }
      return
    }

    const revision = homePlacement.publishedRevision ?? article.draftRevision
    if (!revision) {
      logger.warn('syncArticle: article has no revision', { articleId })
      return
    }

    const kb = await this.db.query.KnowledgeBase.findFirst({
      where: eq(schema.KnowledgeBase.id, article.homeKnowledgeBaseId),
    })
    if (!kb) {
      logger.warn('syncArticle: article has no home KB', { articleId })
      return
    }

    await this.embed({
      articleId,
      kb,
      homePlacementSlug: homePlacement.slug,
      revision,
      logLabel: 'syncArticle',
    })
  }

  /**
   * Embed a *managed* (source-owned) article's DRAFT into its home KB's managed
   * Dataset, **bypassing the publish gate** — source content is searchable as soon
   * as it syncs, before any human publish. The article sink enqueues this per item.
   * Mirrors {@link syncArticle}'s self-heal on `aiEnabled` and its hash-skip.
   */
  async syncManaged(articleId: string): Promise<void> {
    const article = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, articleId),
        eq(schema.Article.organizationId, this.organizationId)
      ),
      with: { draftRevision: true },
    })

    if (!article) {
      logger.warn('syncManaged: article not found', { articleId })
      return
    }
    if (article.articleKind === 'link') return
    if (!article.managed) {
      logger.info('syncManaged: article not managed, skipping', { articleId })
      return
    }

    // Self-heal: if aiEnabled is off, converge to a disabled Document (same as
    // syncArticle), so toggling AI off drops managed source content from search too.
    if (!article.aiEnabled) {
      const doc = await this.findArticleDocumentByArticleId(articleId)
      if (doc?.enabled) {
        await this.db
          .update(schema.Document)
          .set({ enabled: false, updatedAt: new Date() })
          .where(eq(schema.Document.id, doc.id))
      }
      return
    }

    // Managed content lives in the draft — embed it regardless of publish state.
    const revision = article.draftRevision
    if (!revision) {
      logger.warn('syncManaged: article has no draft revision', { articleId })
      return
    }

    const homePlacement = await this.db.query.ArticlePlacement.findFirst({
      where: and(
        eq(schema.ArticlePlacement.articleId, articleId),
        eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
      ),
    })
    if (!homePlacement) {
      logger.warn('syncManaged: article has no home placement', { articleId })
      return
    }

    const kb = await this.db.query.KnowledgeBase.findFirst({
      where: eq(schema.KnowledgeBase.id, article.homeKnowledgeBaseId),
    })
    if (!kb) {
      logger.warn('syncManaged: article has no home KB', { articleId })
      return
    }

    await this.embed({
      articleId,
      kb,
      homePlacementSlug: homePlacement.slug,
      revision,
      logLabel: 'syncManaged',
    })
  }

  /**
   * Mark the article's Document as disabled. Segments stay so re-publish is
   * cheap; the next syncArticle will flip `enabled` back on.
   */
  async unpublishArticle(articleId: string): Promise<void> {
    const doc = await this.findArticleDocumentByArticleId(articleId)
    if (!doc) return
    await this.db
      .update(schema.Document)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(schema.Document.id, doc.id))
  }

  /**
   * Hard-delete the Document for an article. Segments cascade.
   * Caller passes kbId so this still works after the Article row is gone.
   */
  async deleteArticle(articleId: string, _kbId: string): Promise<void> {
    const doc = await this.findArticleDocumentByArticleId(articleId)
    if (!doc) return
    await this.db.delete(schema.Document).where(eq(schema.Document.id, doc.id))
  }

  /**
   * Patch slug/title on the Document and its segments. No re-embed.
   */
  async updateArticleMetadata(articleId: string): Promise<void> {
    const article = await this.db.query.Article.findFirst({
      where: and(
        eq(schema.Article.id, articleId),
        eq(schema.Article.organizationId, this.organizationId)
      ),
      with: { draftRevision: true },
    })
    if (!article) return

    // Placement and KB both key only off article.homeKnowledgeBaseId — fetch
    // them concurrently.
    const [homePlacement, kb] = await Promise.all([
      this.db.query.ArticlePlacement.findFirst({
        where: and(
          eq(schema.ArticlePlacement.articleId, articleId),
          eq(schema.ArticlePlacement.knowledgeBaseId, article.homeKnowledgeBaseId)
        ),
        with: { publishedRevision: true },
      }),
      this.db.query.KnowledgeBase.findFirst({
        where: eq(schema.KnowledgeBase.id, article.homeKnowledgeBaseId),
      }),
    ])
    if (!homePlacement) return
    if (!kb) return

    const doc = await this.findArticleDocumentByArticleId(articleId)
    if (!doc) return

    const revision = homePlacement.publishedRevision ?? article.draftRevision
    const title = revision?.title ?? doc.title
    const kbService = new KBService(this.db, this.organizationId)
    const slugPath = (await kbService.getArticleSlugPath(articleId)) ?? homePlacement.slug

    const prev = (doc.metadata as any) ?? {}
    const prevKb = prev.kb ?? {}
    const newKbMeta = {
      ...prevKb,
      title,
      articleSlug: homePlacement.slug,
      articleSlugPath: slugPath,
      kbSlug: kb.slug,
    }

    // Document and its segments are independent rows — update both concurrently.
    // Segment metadata mirrors the Document's kb metadata so search results can
    // deep-link without re-resolving the article.
    await Promise.all([
      this.db
        .update(schema.Document)
        .set({
          title,
          filename: `${homePlacement.slug}.md`,
          metadata: { ...prev, kb: newKbMeta },
          updatedAt: new Date(),
        })
        .where(eq(schema.Document.id, doc.id)),
      this.db
        .update(schema.DocumentSegment)
        .set({
          metadata: sql`
          COALESCE(${schema.DocumentSegment.metadata}, '{}'::jsonb) ||
          jsonb_build_object(
            'articleSlug', ${homePlacement.slug}::text,
            'articleSlugPath', ${slugPath}::text,
            'kbSlug', ${kb.slug}::text
          )
        `,
          updatedAt: new Date(),
        })
        .where(eq(schema.DocumentSegment.documentId, doc.id)),
    ])
  }

  // ─── internals ────────────────────────────────────────────────────────

  /**
   * The shared embed core for both {@link syncArticle} (publish-gated) and
   * {@link syncManaged} (draft, managed). Builds title-prefixed markdown, hash-skips
   * unchanged content, upserts the article's `Document` in the home KB's managed
   * Dataset, and enqueues segment embeddings. Callers own the gating; this just embeds.
   */
  private async embed(params: {
    articleId: string
    kb: typeof schema.KnowledgeBase.$inferSelect
    homePlacementSlug: string
    revision: typeof schema.ArticleRevision.$inferSelect
    logLabel: string
  }): Promise<void> {
    const { articleId, kb, homePlacementSlug, revision, logLabel } = params

    // Build the indexed markdown — title prepended for recall.
    const body = articleToMarkdown(
      {
        title: revision.title,
        contentJson: revision.contentJson as ArticleNodeJSON[] | null,
      },
      { placeholders: 'literal' }
    )
    const md = `# ${revision.title}\n\n${body}`.trim()
    const contentHash = computeContentHash(md)

    const kbService = new KBService(this.db, this.organizationId)
    const datasetId = await kbService.ensureManagedDataset(kb, kb.createdById)

    // Lookup an existing Document for this article in this dataset.
    const existing = await this.findArticleDocument(datasetId, articleId)

    if (existing) {
      const prevHash = (existing.metadata as any)?.kb?.contentHash as string | undefined
      if (prevHash === contentHash && existing.enabled) {
        logger.info(`${logLabel}: hash unchanged, skipping`, { articleId })
        return
      }
    }

    const checksum = createHash('sha256').update(`${articleId}:${md}`, 'utf8').digest('hex')
    const slugPath = (await kbService.getArticleSlugPath(articleId)) ?? homePlacementSlug

    const baseMetadata = {
      source: 'kb' as const,
      articleId,
      kbId: kb.id,
      articleSlug: homePlacementSlug,
      articleSlugPath: slugPath,
      kbSlug: kb.slug,
      links: [] as Array<{ recordId: string; recordType?: string }>,
    }

    const documentMetadata = {
      kb: { ...baseMetadata, contentHash, title: revision.title },
      contentSource: 'kb-article',
    }

    const documentId = existing
      ? await this.updateExistingDocument(existing.id, {
          title: revision.title,
          checksum,
          size: Buffer.byteLength(md, 'utf8'),
          metadata: documentMetadata,
          enabled: true,
        })
      : await this.insertDocument({
          datasetId,
          title: revision.title,
          filename: `${homePlacementSlug}.md`,
          size: Buffer.byteLength(md, 'utf8'),
          checksum,
          metadata: documentMetadata,
        })

    await DocumentProcessor.processInlineContent(
      {
        documentId,
        datasetId,
        organizationId: this.organizationId,
        userId: kb.createdById,
        content: md,
        contentMetadata: documentMetadata,
        baseMetadata,
      },
      new NullDocumentExecutionReporter()
    )
  }

  private async findArticleDocument(datasetId: string, articleId: string) {
    const [row] = await this.db
      .select()
      .from(schema.Document)
      .where(
        and(
          eq(schema.Document.datasetId, datasetId),
          eq(schema.Document.organizationId, this.organizationId),
          sql`${schema.Document.metadata}->'kb'->>'articleId' = ${articleId}`
        )
      )
      .limit(1)
    return row ?? null
  }

  private async findArticleDocumentByArticleId(articleId: string) {
    const [row] = await this.db
      .select()
      .from(schema.Document)
      .where(
        and(
          eq(schema.Document.organizationId, this.organizationId),
          sql`${schema.Document.metadata}->'kb'->>'articleId' = ${articleId}`
        )
      )
      .limit(1)
    return row ?? null
  }

  private async insertDocument(input: {
    datasetId: string
    title: string
    filename: string
    size: number
    checksum: string
    metadata: Record<string, unknown>
  }): Promise<string> {
    const [inserted] = await this.db
      .insert(schema.Document)
      .values({
        title: input.title,
        filename: input.filename,
        mimeType: 'text/markdown',
        type: DocumentType.MARKDOWN,
        size: input.size,
        checksum: input.checksum,
        status: DocumentStatus.UPLOADED,
        enabled: true,
        metadata: input.metadata,
        datasetId: input.datasetId,
        organizationId: this.organizationId,
        mediaAssetId: null,
        updatedAt: new Date(),
      })
      .returning({ id: schema.Document.id })
    return inserted!.id
  }

  private async updateExistingDocument(
    documentId: string,
    fields: {
      title: string
      checksum: string
      size: number
      metadata: Record<string, unknown>
      enabled: boolean
    }
  ): Promise<string> {
    await this.db
      .update(schema.Document)
      .set({
        title: fields.title,
        checksum: fields.checksum,
        size: fields.size,
        metadata: fields.metadata,
        enabled: fields.enabled,
        status: DocumentStatus.UPLOADED,
        updatedAt: new Date(),
      })
      .where(eq(schema.Document.id, documentId))
    return documentId
  }
}
