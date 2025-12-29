// packages/lib/src/mail-query/mail-query-builder.ts

import { MailViewQueryBuilder as BaseMailViewQueryBuilder } from './mail-view-query-builder'
import { createScopedLogger } from '@auxx/logger'
import { UrlBasedStatusFilter } from './filter-types'
import { InternalFilterContextType, type MailViewFilter } from './types'
import { parseSearchQuery, type ParsedSearchQuery } from './search-query-parser'

const logger = createScopedLogger('mail-query-builder')

// Update the MailQueryInput interface to include parsedSearch
export interface MailQueryInput {
  organizationId: string
  userId?: string // Required for personal contexts

  // Primary context/filter method
  contextType: InternalFilterContextType
  contextId?: string // Tag ID, View ID, Inbox ID

  // Secondary status refinement (optional) - from URL slugs like "open", "done"
  statusFilter?: UrlBasedStatusFilter

  // Complex MailView filter (only used if contextType is VIEW)
  mailViewFilter?: MailViewFilter // This type is also defined in mail-view-query-builder.ts
  // Specific integration IDs (potentially unused if filtering directly on Thread.inboxId)
  integrationIds?: string[]

  searchQuery?: string
  parsedSearch?: ParsedSearchQuery // Add this new property
}

/**
 * Builds Prisma WHERE clauses for fetching Threads based on context, status, search, etc.
 * This is the main orchestrator combining different filter types.
 */
export class MailQueryBuilder {
  private readonly input: MailQueryInput
  private readonly baseMailViewBuilder: BaseMailViewQueryBuilder | null = null
  private readonly parsedSearch: ParsedSearchQuery | null = null

  /**
   * Creates an instance of MailQueryBuilder.
   * @param input - The filtering criteria.
   */
  constructor(input: MailQueryInput) {
    this.input = input

    // Parse search query if not already parsed
    if (input.searchQuery && !input.parsedSearch) {
      this.parsedSearch = parseSearchQuery(input.searchQuery)
    } else {
      this.parsedSearch = input.parsedSearch || null
    }

    // Rest of the constructor remains the same
    // Validate required userId for personal contexts
    if (
      (input.contextType === InternalFilterContextType.PERSONAL_INBOX ||
        input.contextType === InternalFilterContextType.PERSONAL_ASSIGNED ||
        input.contextType === InternalFilterContextType.DRAFTS ||
        input.contextType === InternalFilterContextType.SENT) &&
      !input.userId
    ) {
      throw new Error(`userId is required for context type: ${input.contextType}`)
    }

    // Initialize the base MailView builder only if context is VIEW and filter is valid
    if (input.contextType === InternalFilterContextType.VIEW && input.mailViewFilter) {
      // Validate the structure before passing to the builder
      if (
        typeof input.mailViewFilter === 'object' &&
        input.mailViewFilter !== null &&
        'operator' in input.mailViewFilter &&
        Array.isArray(input.mailViewFilter.conditions)
      ) {
        // Ensure BaseMailViewQueryBuilder is correctly imported or defined
        this.baseMailViewBuilder = new BaseMailViewQueryBuilder(
          input.mailViewFilter,
          input.organizationId
        )
      } else {
        logger.warn('Invalid MailView filter structure provided for VIEW context', {
          viewId: input.contextId,
          filter: input.mailViewFilter,
        })
      }
    }
    logger.debug('MailQueryBuilder initialized', {
      // Avoid logging potentially large mailViewFilter object here unless needed
      input: { ...input, mailViewFilter: input.mailViewFilter ? '[present]' : '[absent]' },
    })
  }

  // Keep the existing buildWhereCondition method unchanged
  // ...
}
