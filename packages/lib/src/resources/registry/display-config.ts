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
export interface SystemResourceDisplayConfig {
  /** Field key to use as primary identifier (e.g., 'email', 'number') */
  identifierField: string

  /** Field ID for primary display field */
  primaryDisplayFieldId: string

  /** Optional field ID for secondary display field */
  secondaryDisplayFieldId?: string

  /** Optional field ID for avatar field */
  avatarFieldId?: string

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
 * Display configuration for each resource type
 * Maps TableId → Display Configuration
 */
export const RESOURCE_DISPLAY_CONFIG: Record<TableId, SystemResourceDisplayConfig> = {
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
    searchFields: ['title', 'sku', 'category', 'description'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
}
