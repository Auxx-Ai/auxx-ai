// packages/database/src/db/schema/article-placement.ts
// Drizzle table: ArticlePlacement — one tree position + publish state per KnowledgeBase.
// An article's content is canonical (Article); its placement(s) decide where it lives in
// each KB tree and its per-KB publish state. ≥1 placement per article (multi-home).

import { createId } from '@paralleldrive/cuid2'
import { textCollateC } from './_collations'
import { type AnyPgColumn, boolean, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { Article } from './article'
import { ArticleRevision } from './article-revision'
import { KnowledgeBase } from './knowledge-base'
import { KnowledgeSource } from './knowledge-source'
import { Organization } from './organization'
import { User } from './user'

/** Drizzle table for articlePlacement */
export const ArticlePlacement = pgTable(
  'ArticlePlacement',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    articleId: text()
      .notNull()
      .references((): AnyPgColumn => Article.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    knowledgeBaseId: text()
      .notNull()
      .references((): AnyPgColumn => KnowledgeBase.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    slug: text().notNull(),
    parentId: text().references((): AnyPgColumn => ArticlePlacement.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),
    sortOrder: textCollateC().default('a0').notNull(),
    isPublished: boolean().default(false).notNull(),
    publishedAt: timestamp({ precision: 3 }),
    publishedRevisionId: text().references((): AnyPgColumn => ArticleRevision.id, {
      onUpdate: 'cascade',
    }),
    publishedById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    hasUnpublishedChanges: boolean().default(false).notNull(),
    /**
     * Set when this placement is a live link to a KnowledgeSource's content
     * (null = native placement). The article sink sets this on source-article
     * placements; detach clears it. Distinct from {@link Article.sourceId}, which
     * marks content provenance — this marks the *position* as source-managed.
     */
    linkedFromSourceId: text().references((): AnyPgColumn => KnowledgeSource.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('ArticlePlacement_kb_slug_key').using(
      'btree',
      table.knowledgeBaseId.asc().nullsLast(),
      table.slug.asc().nullsLast()
    ),
    index('ArticlePlacement_kb_parent_sortOrder_idx').using(
      'btree',
      table.knowledgeBaseId.asc().nullsLast(),
      table.parentId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast()
    ),
    index('ArticlePlacement_articleId_idx').using('btree', table.articleId.asc().nullsLast()),
    index('ArticlePlacement_knowledgeBaseId_idx').using(
      'btree',
      table.knowledgeBaseId.asc().nullsLast()
    ),
    index('ArticlePlacement_parentId_idx').using('btree', table.parentId.asc().nullsLast()),
  ]
)
