// packages/lib/src/workflow-engine/resources/registry/display-config.ts

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

  participant: {
    identifierField: 'id',
    primaryDisplayFieldId: 'name',
    secondaryDisplayFieldId: 'email',
    searchFields: ['name', 'email'],
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
