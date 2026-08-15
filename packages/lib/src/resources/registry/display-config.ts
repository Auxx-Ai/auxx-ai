// packages/lib/src/resources/registry/display-config.ts

import type { TableId } from './field-registry'

/**
 * Organization scoping strategy
 */
export type OrgScopingStrategy = 'direct' | 'join'

/**
 * Configuration for join-based organization scoping
 * Used when a table doesn't have direct organizationId column
 */
export interface JoinScopingConfig {
  /** Join table name (e.g., 'OrganizationMember') */
  joinTable: string

  /** Column in join table that links to main table (e.g., 'userId') */
  joinSourceKey: string

  /** Column in main table to join on (e.g., 'id') */
  mainTableKey: string

  /** Column in join table for organizationId (usually 'organizationId') */
  joinOrgKey: string

  /** Additional conditions for the join (e.g., userType = 'USER') */
  additionalConditions?: Record<string, any>
}

/**
 * Display configuration for system resources
 * Uses field IDs that reference actual ResourceField definitions
 */
export interface ResourceDisplayConfig {
  /** Field key to use as primary identifier (e.g., 'email', 'number') */
  identifierField: string

  /** Field ID for primary display field */
  primaryDisplayFieldId: string

  /** Optional field ID for secondary display field */
  secondaryDisplayFieldId?: string

  /** Optional field ID for avatar field */
  avatarFieldId?: string

  /** Optional field key on the row to use as a per-record icon (e.g. emoji). */
  iconFieldId?: string

  /** Optional field key on the row to use as a per-record color tint. */
  colorFieldId?: string

  /** Field keys to search across (supports ilike) */
  searchFields: string[]

  /** Default sort field */
  defaultSortField?: string

  /** Default sort direction */
  defaultSortDirection?: 'asc' | 'desc'

  /** Organization scoping strategy (default: 'direct') */
  orgScopingStrategy?: OrgScopingStrategy

  /** Join configuration (required if orgScopingStrategy is 'join') */
  joinScoping?: JoinScopingConfig

  /** Relations to include in query (for secondary info that needs related data) */
  withRelations?: Record<string, any>

  /**
   * Rows this table never exposes through the picker, as `column → excluded
   * values`. Applied by `fetchResourcesDirect` to EVERY picker path — list,
   * search and by-ids hydration alike.
   *
   * This exists because "which rows of this table are addressable" is a property
   * of the table, not of one caller: `kb` rows of `kind: 'source'` are hidden
   * containers owned by `KnowledgeSource` and are already filtered out of
   * `listKnowledgeBases`, whose comment names pickers as a place they must never
   * reach. Encoding it only in that one query left the picker free to surface
   * them the moment a second read path opened.
   *
   * ⚠ **Only sound on a `NOT NULL` column.** The predicate is
   * `NOT (col IN (…))`, which is NULL — and therefore false — for a NULL cell, so
   * a nullable column would drop the very rows it is meant to keep. Both current
   * entries qualify (`KnowledgeBase.kind`, `Dataset.isManaged`); check the schema
   * before adding a third, and use a scope predicate rather than this if the
   * column can be NULL.
   */
  neverPickable?: Record<string, readonly (string | boolean)[]>
}

/**
 * Display configuration per resource type. Maps TableId → Display Configuration.
 *
 * **Partial on purpose.** `TableId` spans every `ModelType`, including the def-backed types
 * (`company`, `invoice`, `quote`, `work_order`, …) that resolve their display fields from their
 * `EntityDefinition` instead of from this static map. Declaring it total said those entries
 * existed; every read site therefore skipped its undefined check and would have thrown
 * "cannot read properties of undefined" on the first def-backed lookup.
 */
export const RESOURCE_DISPLAY_CONFIG: Partial<Record<TableId, ResourceDisplayConfig>> = {
  ticket: {
    identifierField: 'number',
    primaryDisplayFieldId: 'title',
    secondaryDisplayFieldId: 'number',
    searchFields: ['title', 'number'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
    withRelations: {
      contact: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      assignments: {
        with: {
          agent: {
            columns: { id: true, name: true, email: true },
          },
        },
      },
    },
  },

  contact: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    secondaryDisplayFieldId: 'email',
    avatarFieldId: 'avatarUrl',
    searchFields: ['name', 'firstName', 'lastName', 'email', 'phone'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
    withRelations: {
      customerSources: {
        columns: { id: true, source: true, email: true, sourceId: true },
      },
      customerGroups: {
        with: { customerGroup: true },
      },
    },
  },

  user: {
    identifierField: 'email',
    primaryDisplayFieldId: 'name',
    secondaryDisplayFieldId: 'email',
    avatarFieldId: 'image',
    searchFields: ['name', 'email'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'join',
    joinScoping: {
      joinTable: 'OrganizationMember',
      joinSourceKey: 'userId',
      mainTableKey: 'id',
      joinOrgKey: 'organizationId',
      additionalConditions: {
        userType: 'USER',
      },
    },
  },

  thread: {
    identifierField: 'id',
    primaryDisplayFieldId: 'subject',
    searchFields: ['subject'],
    defaultSortField: 'lastMessageAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
    withRelations: {
      messages: {
        with: { from: true },
        orderBy: (messages: any, { desc }: any) => [desc(messages.sentAt)],
        limit: 1,
      },
    },
  },

  inbox: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    secondaryDisplayFieldId: 'email',
    searchFields: ['name', 'email'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  // Plan 40: a personal mailbox is its own EntityDefinition. Same display shape
  // as `inbox`, minus the `email` references — neither registry has such a field.
  personal_inbox: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    searchFields: ['name'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  message: {
    identifierField: 'id',
    primaryDisplayFieldId: 'subject',
    searchFields: ['subject', 'from'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  // ⚠ `Participant` has NO `email` column — a participant's address lives in
  // `identifier`, typed by `identifierType` (EMAIL / PHONE). This entry named
  // `email` as both the secondary display field and a search field from the
  // initial commit onward, which made `requireColumn` throw on every search:
  // swallowed and logged in the global union (`searchGlobalUnion`'s per-kind
  // catch), an uncaught 500 on scoped `record.search({entityDefinitionId:
  // 'participant'})`. See `resources/registry/display-config.test.ts`, which now
  // fails on any display config naming a column its table does not have.
  //
  // 🔴 NOT repointed at `identifier`, deliberately. `Participant` is org-wide
  // with no inbox column and no mail lens, so making addresses text-searchable
  // through the generic record path would hand any member with `Records: Read` a
  // typeahead over every identity that has ever mailed the org — including ones
  // that only ever appeared in another member's PERSONAL mailbox. That is a
  // visibility decision, not a bug fix. `displayName` is not a safe substitute
  // either: it equals the raw address for roughly a third of rows.
  participant: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    searchFields: ['name'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  dataset: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    searchFields: ['name', 'description'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
    // Every knowledge base owns a MANAGED dataset (`__kb:<id>`) holding its
    // articles' embeddings, and those are deliberately hidden from every dataset
    // surface: `dataset-service.ts` defaults `hideManaged`, and `dataset.list` /
    // `dataset.stats` filter `isManaged = false`. The picker had no equivalent —
    // harmless only while `record.search` refused the whole `dataset` key, and a
    // leak of internal plumbing into every dataset picker the moment it didn't.
    // The `kb` twin of this rule is `neverPickable: { kind: ['source'] }` below.
    neverPickable: { isManaged: [true] },
  },

  part: {
    identifierField: 'sku',
    primaryDisplayFieldId: 'title',
    avatarFieldId: 'image',
    searchFields: ['title', 'sku', 'category', 'description'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  article: {
    identifierField: 'id',
    primaryDisplayFieldId: 'title',
    secondaryDisplayFieldId: 'excerpt',
    iconFieldId: 'emoji',
    colorFieldId: 'color',
    searchFields: ['title', 'excerpt'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  kb: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    secondaryDisplayFieldId: 'slug',
    searchFields: ['name', 'slug', 'description'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
    // `source` only — NOT `learned`. Source KBs are internal containers with no
    // UI of their own. The `learned` KB (AI Memory) is a real, member-facing
    // knowledge base, and since plan v3/06 P4 it is returned by
    // `listKnowledgeBases` too — that query was filtering `kind = 'standard'`,
    // which meant no Share card could ever be rendered for AI Memory and no `kb`
    // grant row could be authored against it. Excluding it here would make the
    // AI Memory KB unresolvable anywhere it is referenced.
    neverPickable: { kind: ['source'] },
  },

  visit: {
    identifierField: 'id',
    primaryDisplayFieldId: 'id',
    searchFields: ['id'],
    defaultSortField: 'startTime',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
}
