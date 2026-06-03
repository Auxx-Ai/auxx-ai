// packages/database/src/db/schema/knowledge-source.ts
// Drizzle table: KnowledgeSource — an external content source (website crawl, Shopify,
// file upload, third-party KB) ingested into a KnowledgeBase. See plans/kb/sources/.

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  knowledgeSourceStatus,
  knowledgeSourceSurface,
  knowledgeSourceSyncBehavior,
  pgTable,
  text,
  timestamp,
} from './_shared'
import { Article } from './article'
import { KnowledgeBase } from './knowledge-base'
import { Organization } from './organization'
import { User } from './user'

/**
 * Connector kinds. Stored as a `text` column (not a pgEnum) so new connectors can
 * ship without an enum-alter migration. Use this union for type-safety in app code.
 */
export const KNOWLEDGE_SOURCE_TYPES = [
  'manual',
  'website',
  'shopify',
  'file',
  'notion',
  'confluence',
  'zendesk',
] as const
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number]

/** Drizzle table for knowledgeSource */
export const KnowledgeSource = pgTable(
  'KnowledgeSource',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    /** Connector kind — text-backed {@link KnowledgeSourceType}, not a pgEnum. */
    type: text().$type<KnowledgeSourceType>().notNull(),
    name: text().notNull(),
    /** 'publishable' (default) = Locked articles; 'ai-only' = Dataset docs (Phase 4). */
    surface: knowledgeSourceSurface().default('publishable').notNull(),
    /** Per-type config: { url, selectedPaths[], ... } | { shopifyDomain, kinds[] } | { items[] } | ... */
    config: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
    /**
     * The hidden KnowledgeBase (kind='source') this source owns. Its synced articles
     * home here and embed once into this KB's dataset; they are then *linked* into
     * user-facing KBs via ArticlePlacement.linkedFromSourceId. Deleting the source
     * deletes this KB (handled explicitly in deleteSource).
     */
    ownedKnowledgeBaseId: text()
      .notNull()
      .references((): AnyPgColumn => KnowledgeBase.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /**
     * The source's root category Article (its home placement lives in the owned KB).
     * Children of the source nest under it in that KB's tree. `set null` +
     * Article.sourceId `set null` break the reference cycle on delete; the orchestrator
     * deletes managed articles explicitly on source delete.
     */
    rootFolderArticleId: text().references((): AnyPgColumn => Article.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    syncBehavior: knowledgeSourceSyncBehavior().default('manual').notNull(),
    /** null in Phase 1; ScheduledTriggerConfig once scheduling lands (Phase 3). */
    scheduleConfig: jsonb(),
    status: knowledgeSourceStatus().default('pending').notNull(),
    lastSyncedAt: timestamp({ precision: 3 }),
    lastJobId: text(),
    itemCount: integer().default(0).notNull(),
    error: text(),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    index('KnowledgeSource_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('KnowledgeSource_ownedKnowledgeBaseId_idx').using(
      'btree',
      table.ownedKnowledgeBaseId.asc().nullsLast()
    ),
  ]
)
