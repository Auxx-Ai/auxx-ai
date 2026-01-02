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
 * Display configuration for resource pickers
 * Defines which fields to use for display, search, and avatars
 */
export interface ResourceDisplayConfig {
  /** Field key to use as primary identifier (e.g., 'email', 'number') */
  identifierField: string

  /** Field key or function to generate display name */
  displayNameField: string | ((row: Record<string, any>) => string)

  /** Optional field key or function for secondary info (subtitle) */
  secondaryInfoField?: string | ((row: Record<string, any>) => string)

  /** Optional field key for avatar image */
  avatarField?: string

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
export const RESOURCE_DISPLAY_CONFIG: Record<TableId, ResourceDisplayConfig> = {
  ticket: {
    identifierField: 'number',
    displayNameField: 'title',
    secondaryInfoField: (row) => `#${row.number} • ${row.status}`,
    searchFields: ['title', 'number'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct', // Has organizationId column
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
    identifierField: 'email',
    displayNameField: (row) =>
      row.name || `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.email,
    secondaryInfoField: 'email',
    avatarField: 'avatarUrl',
    searchFields: ['name', 'firstName', 'lastName', 'email', 'phone'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct', // Has organizationId column
    withRelations: {
      customerSources: {
        columns: { id: true, source: true, email: true, sourceId: true },
      },
      customerGroups: {
        with: { customerGroup: true },
      },
    },
  },

  // User table requires join through OrganizationMember
  user: {
    identifierField: 'email',
    displayNameField: 'name',
    secondaryInfoField: 'email',
    avatarField: 'image',
    searchFields: ['name', 'email'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'join', // Requires join!
    joinScoping: {
      joinTable: 'OrganizationMember',
      joinSourceKey: 'userId',
      mainTableKey: 'id',
      joinOrgKey: 'organizationId',
      additionalConditions: {
        userType: 'USER', // Exclude system users
      },
    },
  },

  thread: {
    identifierField: 'id',
    displayNameField: 'subject',
    secondaryInfoField: (row) => {
      // Get the last message sender's email from included relations
      const lastMessage = row.messages?.[0]
      const fromParticipant = lastMessage?.from
      return fromParticipant?.identifier || fromParticipant?.name || row.status || ''
    },
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
    displayNameField: 'name',
    secondaryInfoField: 'email',
    searchFields: ['name', 'email'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  message: {
    identifierField: 'id',
    displayNameField: (row) => row.subject || `Message ${row.id?.slice(0, 8)}`,
    secondaryInfoField: (row) => row.from || '',
    searchFields: ['subject', 'from'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  participant: {
    identifierField: 'id',
    displayNameField: (row) => row.name || row.email || `Participant ${row.id?.slice(0, 8)}`,
    secondaryInfoField: 'email',
    searchFields: ['name', 'email'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  dataset: {
    identifierField: 'id',
    displayNameField: 'name',
    secondaryInfoField: (row) => `${row.documentCount ?? 0} docs • ${row.status}`,
    searchFields: ['name', 'description'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },

  part: {
    identifierField: 'sku',
    displayNameField: 'title',
    secondaryInfoField: (row) => {
      const parts = []
      if (row.sku) parts.push(row.sku)
      if (row.category) parts.push(row.category)
      return parts.join(' • ')
    },
    searchFields: ['title', 'sku', 'category', 'description'],
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
}
