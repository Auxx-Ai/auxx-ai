// packages/lib/src/mail-query/mail-query-builder.ts
import { database, schema } from '@auxx/database'
import { DraftMode, ThreadStatus } from '@auxx/database/enums'
import {
  SQL,
  and,
  or,
  eq,
  ne,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  ilike,
  gt,
  lt,
  gte,
  lte,
  exists,
  sql,
} from 'drizzle-orm'
import { whereThreadMessageType, whereThreadProvider } from '../providers/query-helpers'
import { integrationTypeToProvider } from '../providers/type-utils'
import type { MessageType } from '../providers/types'
// Assuming BaseMailViewQueryBuilder is the detailed builder defined in this file previously,
// or imported from its own file if separated. Adjust import if needed.
import {
  MailViewQueryBuilder as BaseMailViewQueryBuilder, // Renaming import to avoid conflict
} from './mail-view-query-builder'
import { createScopedLogger } from '@auxx/logger'
import { UrlBasedStatusFilter } from './filter-types' // Adjust path if needed
import { InternalFilterContextType, type MailViewFilter } from './types'

import {
  parseSearchQuery,
  type ParsedSearchQuery,
  type SearchToken,
  isOperator,
  isPlainText,
  SearchOperator,
  IsOperatorValue,
} from './search-query-parser'
import {
  threadHasAnyTags,
  threadHasNoTags,
  threadHasTags,
  threadHasTagMatchingSearch,
} from '../field-values/relationship-queries'

const logger = createScopedLogger('mail-query-builder')

/**
 * Defines the primary context for filtering threads, derived from URL structure or API call intent.
 * Examples: User viewing their assigned items, viewing a specific shared inbox, etc.
 */

/**
 * Input structure for the MailQueryBuilder, combining context, status, and other filters.
 */
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
 * Builds Drizzle WHERE clauses for fetching Threads based on context, status, search, etc.
 * This is the main orchestrator combining different filter types.
 */
export class MailQueryBuilder {
  private readonly input: MailQueryInput
  // Holds an instance of the detailed MailView filter processor if context is VIEW
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

  /**
   * Constructs the final Drizzle WHERE condition by combining all applicable filters.
   * @returns {SQL | undefined} The combined WHERE clause.
   */
  buildWhereCondition(): SQL | undefined {
    let conditions: SQL[] = []

    try {
      // 1. Always scope by Organization ID
      if (!this.input.organizationId) {
        throw new Error('organizationId is required for thread queries')
      }
      conditions.push(eq(schema.Thread.organizationId, this.input.organizationId))

      // 2. Get primary context filtering condition
      const baseContextCondition = this.buildContextCondition()
      if (baseContextCondition) {
        conditions.push(baseContextCondition)
      } else if (this.input.contextType !== InternalFilterContextType.ALL) {
        // Only return no match if it's not the ALL context type
        // For ALL context, undefined is valid - no context filtering needed
        return eq(schema.Thread.id, '__NO_MATCH__')
      }

      // 3. Apply Status Filters ONLY IF context is NOT VIEW
      if (this.input.contextType !== InternalFilterContextType.VIEW) {
        const isStatusApplicableContext =
          this.input.contextType !== InternalFilterContextType.DRAFTS &&
          this.input.contextType !== InternalFilterContextType.SENT

        // 4. Apply EXPLICIT secondary status filter (if provided and applicable)
        if (isStatusApplicableContext && this.input.statusFilter) {
          const explicitStatusCondition = this.buildStatusCondition(this.input.statusFilter)
          if (explicitStatusCondition) {
            conditions.push(explicitStatusCondition)
          }
        }
        // 5. Apply DEFAULT status condition (if applicable AND no explicit status filter was applied)
        else if (isStatusApplicableContext && !this.input.statusFilter) {
          // Only apply default if NO explicit filter provided
          const defaultStatusCondition = this.getDefaultStatusForContext(this.input.contextType)
          if (defaultStatusCondition) {
            conditions.push(defaultStatusCondition)
          }
        }
      }

      // 6. Apply search query
      if (this.input.searchQuery && this.input.searchQuery.trim() !== '') {
        const search = this.input.searchQuery.trim()
        const searchCondition = this.buildSearchCondition(search)
        if (searchCondition) {
          conditions.push(searchCondition)
        }
      }

      // 7. Combine remaining valid conditions using AND
      const validConditions = conditions.filter((cond) => cond !== undefined)

      if (validConditions.length === 0) {
        logger.error('Query builder resulted in NO valid conditions!', { input: this.input })
        return eq(schema.Thread.id, '__NO_MATCH_ERROR__')
      }
      if (validConditions.length === 1) {
        return validConditions[0]
      }

      return and(...validConditions)
    } catch (error: unknown) {
      logger.error('Failed to build WHERE condition', {
        error: error instanceof Error ? error.message : error,
      })
      return eq(schema.Thread.id, '__BUILD_ERROR__')
    }
  }

  /**
   * Builds the WHERE clause for text search across relevant fields.
   * Now supports structured search queries with operators.
   * @param query - The search query string.
   * @returns {SQL | undefined} The condition for text search.
   */
  private buildSearchCondition(query: string): SQL | undefined {
    // Use the parsed search if available, otherwise fallback to simple text search
    if (!this.parsedSearch || !this.parsedSearch.hasStructuredQuery) {
      return this.buildSimpleTextSearchCondition(query)
    }

    logger.debug('Building structured search condition', {
      tokenCount: this.parsedSearch.tokens.length,
      hasStructuredQuery: this.parsedSearch.hasStructuredQuery,
    })

    // Process each token and build corresponding conditions
    const conditions: SQL[] = []

    for (const token of this.parsedSearch.tokens) {
      try {
        const condition = this.buildTokenCondition(token)
        if (condition) {
          // For negated tokens, wrap with NOT
          if (token.negated) {
            conditions.push(sql`NOT (${condition})`)
          } else {
            conditions.push(condition)
          }
        }
      } catch (error) {
        logger.warn(`Error processing search token "${token.raw}"`, {
          error: error instanceof Error ? error.message : String(error),
          token,
        })
        // Skip the problematic token and continue with others
      }
    }

    // Handle the case where we only have plain text terms (without operators)
    const plainTextTerms = this.parsedSearch.plainTextTerms
    if (plainTextTerms.length > 0 && !this.parsedSearch.hasStructuredQuery) {
      conditions.push(this.buildSimpleTextSearchCondition(plainTextTerms.join(' ')))
    }

    // Combine conditions with AND
    if (conditions.length === 0) {
      return undefined // Empty condition if nothing to search
    } else if (conditions.length === 1) {
      return conditions[0] // Just return the single condition
    } else {
      return and(...conditions) // Combine multiple conditions with AND
    }
  }

  /**
   * Builds the WHERE clause based on the primary context type and ID.
   * Includes default TRASH/SPAM exclusion unless context dictates otherwise (e.g., VIEW).
   * @returns {SQL | undefined} The condition specific to the context, or undefined on error.
   */
  private buildContextCondition(): SQL | undefined {
    const { contextType, contextId, userId } = this.input

    // Base filter applied to most contexts that aren't explicitly TRASH/SPAM views
    const defaultExclusions = notInArray(schema.Thread.status, ['TRASH', 'SPAM'])

    try {
      switch (contextType) {
        case InternalFilterContextType.PERSONAL_ASSIGNED:
        case InternalFilterContextType.PERSONAL_INBOX: // Treat Personal Inbox as items assigned to user
          logger.debug(`Building context ${contextType}: Assignee = userId, Excluding TRASH/SPAM`)
          if (!userId) throw new Error(`userId is required for ${contextType}`)
          // Apply default exclusions AND filter by assigneeId
          return and(defaultExclusions, eq(schema.Thread.assigneeId, userId))

        case InternalFilterContextType.TAG:
          if (!contextId) throw new Error('contextId (tagId) is required for TAG context')
          logger.debug(
            `Building context ${contextType}: Has Tag=${contextId}, Excluding TRASH/SPAM`
          )
          // Apply default exclusions AND filter by tag presence using FieldValue relationship
          return and(
            defaultExclusions,
            threadHasTags(database, schema.Thread.id, [contextId], organizationId)
          )

        case InternalFilterContextType.VIEW:
          if (!contextId) throw new Error('contextId (viewId) is required for VIEW context')
          if (this.baseMailViewBuilder) {
            const mailViewWhere = this.baseMailViewBuilder.buildWhereCondition()
            // Mail views define their own filters, INCLUDING status.
            // DO NOT apply defaultExclusions here; let the view filters handle status.
            logger.info('Applying MailView as primary context filter', { viewId: contextId })
            // Return the generated view condition, or an empty object if the view had no conditions
            return Object.keys(mailViewWhere).length > 0 ? mailViewWhere : {}
          }
          logger.error(
            // Log as error if builder wasn't created
            'MailView context specified but no valid filter/builder found',
            { viewId: contextId }
          )
          return undefined // Indicate error state

        case InternalFilterContextType.ALL_INBOXES:
          logger.debug(`Building context ${contextType}: Applying default exclusions`)
          // View of all inboxes, just apply default exclusions
          return defaultExclusions

        case InternalFilterContextType.SPECIFIC_INBOX:
          if (!contextId) {
            logger.error('contextId (inboxId) is required for SPECIFIC_INBOX context type')
            throw new Error('contextId (inboxId) is required for SPECIFIC_INBOX context')
          }
          logger.debug(
            `Building context ${contextType}: Filtering by inboxId=${contextId}, Excluding TRASH/SPAM`
          )
          // Note: Thread.inboxId was removed in migration 0028
          // Filter by inbox through InboxIntegration join
          return and(
            defaultExclusions,
            exists(
              database
                .select()
                .from(schema.InboxIntegration)
                .where(
                  and(
                    eq(schema.InboxIntegration.inboxId, contextId),
                    eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId)
                  )
                )
            )
          )

        case InternalFilterContextType.DRAFTS:
          logger.debug(`Building context ${contextType}: User's drafts`)
          if (!userId) throw new Error(`userId is required for ${contextType}`)
          // Filter threads containing user's draft messages. Exclude TRASH/SPAM threads.
          return and(
            defaultExclusions, // Exclude TRASH/SPAM threads
            exists(
              database
                .select()
                .from(schema.Message)
                .where(
                  and(
                    eq(schema.Message.threadId, schema.Thread.id),
                    ne(schema.Message.draftMode, DraftMode.NONE),
                    eq(schema.Message.createdById, userId)
                  )
                )
            )
          )

        case InternalFilterContextType.SENT:
          logger.debug(`Building context ${contextType}: User's sent items`)
          if (!userId) throw new Error(`userId is required for ${contextType}`)
          // Find threads where the user sent at least one message (not drafts). Exclude TRASH/SPAM threads.
          return and(
            defaultExclusions, // Exclude TRASH/SPAM threads
            exists(
              database
                .select()
                .from(schema.Message)
                .where(
                  and(
                    eq(schema.Message.threadId, schema.Thread.id),
                    eq(schema.Message.createdById, userId),
                    eq(schema.Message.draftMode, DraftMode.NONE),
                    eq(schema.Message.isInbound, false),
                    isNotNull(schema.Message.sentAt)
                  )
                )
            )
          )
        case InternalFilterContextType.ALL:
          logger.debug(`Building context ${contextType}: All threads`)
          // No specific filtering needed for ALL context
          return undefined

        default: {
          // Make sure all enum cases are handled
          const exhaustiveCheck: never = contextType
          logger.error('Unhandled context type in buildContextCondition', { contextType })
          return undefined // Indicate error state
        }
      }
    } catch (error: any) {
      logger.error(`Error building context condition for ${contextType}`, {
        error: error.message,
        stack: error.stack,
      })
      // Re-throw or return null to indicate failure
      return null
    }
  }

  /**
   * Builds the WHERE clause based on the secondary status filter (e.g., "open", "done").
   * This applies *in addition* to context filters.
   * @param statusFilter - The status filter derived from the URL slug.
   * @returns {SQL | undefined} The condition specific to the status, or undefined if filter is 'all' or invalid.
   */
  private buildStatusCondition(statusFilter: UrlBasedStatusFilter): SQL | undefined {
    const { contextType, userId } = this.input // userId might be needed for context-dependent interpretation
    logger.debug(
      `Building explicit status condition '${statusFilter}' for context '${contextType}'`
    )

    try {
      switch (statusFilter) {
        case UrlBasedStatusFilter.OPEN:
          // Explicitly filter for OPEN status threads
          return eq(schema.Thread.status, ThreadStatus.OPEN) // OPEN

        case UrlBasedStatusFilter.DONE:
          // Explicitly filter for ARCHIVED status threads
          return eq(schema.Thread.status, ThreadStatus.ARCHIVED) // ARCHIVED

        case UrlBasedStatusFilter.TRASH:
          return eq(schema.Thread.status, ThreadStatus.TRASH) // TRASH

        case UrlBasedStatusFilter.SPAM:
          return eq(schema.Thread.status, ThreadStatus.SPAM) // SPAM

        case UrlBasedStatusFilter.ASSIGNED:
          // Filter for threads that have an assignee AND are OPEN (not archived/done)
          return and(isNotNull(schema.Thread.assigneeId), eq(schema.Thread.status, ThreadStatus.OPEN))

        case UrlBasedStatusFilter.UNASSIGNED:
          // Filter for threads that have no assignee AND are OPEN (not archived/done)
          return and(isNull(schema.Thread.assigneeId), eq(schema.Thread.status, ThreadStatus.OPEN))

        case UrlBasedStatusFilter.ALL:
          // 'ALL' means don't add an *explicit* status filter based on this parameter.
          return undefined

        case UrlBasedStatusFilter.SNOOZED:
          logger.warn('Snoozed filter is not yet implemented.')
          return eq(schema.Thread.id, '__NO_MATCH__') // Match nothing until implemented

        // DRAFTS and SENT are handled by contextType, not statusFilter
        case UrlBasedStatusFilter.DRAFTS:
        case UrlBasedStatusFilter.SENT:
          logger.warn(
            `Status filter ${statusFilter} ignored as it should be handled by primary context.`
          )
          return undefined

        default: {
          // Ensure all enum cases are handled
          const exhaustiveCheck: never = statusFilter
          logger.warn('Unknown status filter provided, ignoring.', { statusFilter })
          return undefined
        }
      }
    } catch (error: any) {
      logger.error(`Error building status condition for ${statusFilter}`, {
        error: error.message,
        stack: error.stack,
      })
      throw error // Re-throw errors
    }
  }

  /**
   * Gets the default status condition for contexts where no explicit status filter was provided.
   * This is applied *after* the context condition but *before* an explicit status filter.
   * @param contextType - The primary context type.
   * @returns {SQL | undefined} The default status condition or undefined if no default applies.
   */
  private getDefaultStatusForContext(contextType: InternalFilterContextType): SQL | undefined {
    switch (contextType) {
      // For personal views (inbox/assigned) and tag views, default to seeing OPEN items
      case InternalFilterContextType.PERSONAL_ASSIGNED:
      case InternalFilterContextType.PERSONAL_INBOX:
      case InternalFilterContextType.TAG:
        logger.debug(`Applying default status OPEN for context ${contextType}`)
        return eq(schema.Thread.status, ThreadStatus.OPEN) // OPEN

      // For shared inbox views (all or specific), default to seeing OPEN and UNASSIGNED items
      case InternalFilterContextType.ALL_INBOXES:
      case InternalFilterContextType.SPECIFIC_INBOX:
        logger.debug(`Applying default status OPEN and UNASSIGNED for context ${contextType}`)
        // return { assigneeId: null, status: ThreadStatus.OPEN }
        return eq(schema.Thread.status, ThreadStatus.OPEN) // OPEN

      // Contexts that manage their own status implicitly or don't need a default
      case InternalFilterContextType.VIEW: // View defines its own filters including status
      case InternalFilterContextType.DRAFTS: // Drafts filter by message state
      case InternalFilterContextType.SENT: // Sent filter by message state/sender
      case InternalFilterContextType.ALL: // ALL context shows all threads, no status filter
        logger.debug(`No default status applied for context ${contextType}`)
        return undefined

      default: {
        // Ensure all enum cases are handled
        logger.warn('No default status defined for context type', { contextType })
        return undefined
      }
    }
  }

  /**
   * Builds search condition for a simple text search (no operators).
   * @param query - The search query text.
   * @returns {SQL | undefined} The condition for simple text search.
   */
  private buildSimpleTextSearchCondition(query: string): SQL | undefined {
    if (!query || query.trim() === '') return undefined

    // Basic search: contains the whole query string in one of the fields
    return or(
      // Search Thread Subject
      ilike(schema.Thread.subject, `%${query}%`),
      // Search Message Snippet
      exists(
        database
          .select()
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.threadId, schema.Thread.id),
              ilike(schema.Message.snippet, `%${query}%`)
            )
          )
      ),
      // Search Participant Identifier
      exists(
        database
          .select()
          .from(schema.Message)
          .innerJoin(
            schema.MessageParticipant,
            eq(schema.MessageParticipant.messageId, schema.Message.id)
          )
          .innerJoin(
            schema.Participant,
            eq(schema.Participant.id, schema.MessageParticipant.participantId)
          )
          .where(
            and(
              eq(schema.Message.threadId, schema.Thread.id),
              ilike(schema.Participant.identifier, `%${query}%`)
            )
          )
      ),
      // Search Participant Display Name
      exists(
        database
          .select()
          .from(schema.Message)
          .innerJoin(
            schema.MessageParticipant,
            eq(schema.MessageParticipant.messageId, schema.Message.id)
          )
          .innerJoin(
            schema.Participant,
            eq(schema.Participant.id, schema.MessageParticipant.participantId)
          )
          .where(
            and(
              eq(schema.Message.threadId, schema.Thread.id),
              ilike(schema.Participant.displayName, `%${query}%`)
            )
          )
      )
    )
  }

  /**
   * Builds a Drizzle condition for a specific search token.
   * @param token - The parsed search token.
   * @returns {SQL | undefined} The condition for the token.
   */
  private buildTokenCondition(token: SearchToken): SQL | undefined {
    // Handle plain text terms
    if (isPlainText(token)) {
      return this.buildSimpleTextSearchCondition(token.value)
    }

    // Handle operator-based terms
    const operator = token.operator?.toLowerCase()
    const value = token.value.trim()

    if (!operator || value === '') {
      return undefined // Empty condition for empty values
    }

    // Route to specific operator handlers
    switch (operator) {
      case SearchOperator.ASSIGNEE:
        return this.buildAssigneeCondition(value)
      case SearchOperator.SUBJECT:
        return this.buildSubjectCondition(value)
      case SearchOperator.BODY:
        return this.buildBodyCondition(value)
      case SearchOperator.IS:
        return this.buildIsCondition(value)
      case SearchOperator.TAG:
        return this.buildTagCondition(value)
      case SearchOperator.INBOX:
        return this.buildInboxCondition(value)
      case SearchOperator.FROM:
        return this.buildContactCondition('FROM', value)
      case SearchOperator.TO:
        return this.buildContactCondition('TO', value)
      case SearchOperator.CC:
        return this.buildContactCondition('CC', value)
      case SearchOperator.BCC:
        return this.buildContactCondition('BCC', value)
      case SearchOperator.BEFORE:
      case SearchOperator.AFTER:
      case SearchOperator.DURING:
        return this.buildDateCondition(operator, value)
      case SearchOperator.AUTHOR:
        return this.buildAuthorCondition(value)
      case SearchOperator.WITH:
        return this.buildWithCondition(value)
      case SearchOperator.RECIPIENT:
        return this.buildRecipientCondition(value)
      case SearchOperator.HAS:
        return this.buildHasCondition(value)
      case SearchOperator.TYPE:
        return this.buildTypeCondition(value)
      default:
        logger.warn(`Unsupported search operator: ${operator}`)
        return undefined // Return empty condition for unsupported operators
    }
  }

  /**
   * Builds a condition for assignee search.
   * @param value - The assignee name or email.
   * @returns {SQL | undefined} The condition.
   */
  private buildAssigneeCondition(value: string): SQL | undefined {
    // Special handling for "me" value when userId is available
    if (value.toLowerCase() === 'me' && this.input.userId) {
      return eq(schema.Thread.assigneeId, this.input.userId)
    }

    return exists(
      database
        .select()
        .from(schema.User)
        .where(
          and(
            eq(schema.User.id, schema.Thread.assigneeId),
            or(ilike(schema.User.name, `%${value}%`), ilike(schema.User.email, `%${value}%`))
          )
        )
    )
  }

  /**
   * Builds a condition for subject search.
   * @param value - The subject text to search for.
   * @returns {SQL | undefined} The condition.
   */
  private buildSubjectCondition(value: string): SQL | undefined {
    return ilike(schema.Thread.subject, `%${value}%`)
  }

  /**
   * Builds a condition for body content search.
   * @param value - The body text to search for.
   * @returns {SQL | undefined} The condition.
   */
  private buildBodyCondition(value: string): SQL | undefined {
    return exists(
      database
        .select()
        .from(schema.Message)
        .where(
          and(
            eq(schema.Message.threadId, schema.Thread.id),
            or(
              ilike(schema.Message.textPlain, `%${value}%`),
              ilike(schema.Message.snippet, `%${value}%`)
            )
          )
        )
    )
  }

  /**
   * Builds a condition for status-based search (is:unread, is:archived, etc.).
   * @param value - The status value.
   * @returns {SQL | undefined} The condition.
   */
  private buildIsCondition(value: string): SQL | undefined {
    const isValue = value.toLowerCase()

    switch (isValue) {
      case IsOperatorValue.UNREAD:
        // For unread, we need to check if there's a userId context
        if (this.input.userId) {
          // User has no read status OR last read time is older than last message time
          return or(
            // User has no read status entries
            sql`NOT EXISTS (
              SELECT 1 FROM ${schema.ThreadReadStatus}
              WHERE ${schema.ThreadReadStatus.threadId} = ${schema.Thread.id}
              AND ${schema.ThreadReadStatus.userId} = ${this.input.userId}
            )`,
            // User has read status but is marked as unread or read time is old
            exists(
              database
                .select()
                .from(schema.ThreadReadStatus)
                .where(
                  and(
                    eq(schema.ThreadReadStatus.threadId, schema.Thread.id),
                    eq(schema.ThreadReadStatus.userId, this.input.userId),
                    eq(schema.ThreadReadStatus.isRead, false)
                  )
                )
            )
          )
        }
        // Without userId, we can't determine read status
        return undefined

      case IsOperatorValue.ARCHIVED:
        return eq(schema.Thread.status, 'ARCHIVED')

      case IsOperatorValue.OPEN:
        return eq(schema.Thread.status, 'OPEN')

      case IsOperatorValue.SPAM:
        return eq(schema.Thread.status, 'SPAM')

      case IsOperatorValue.TRASHED:
        return eq(schema.Thread.status, 'TRASH')

      case IsOperatorValue.ASSIGNED:
        return isNotNull(schema.Thread.assigneeId)

      case IsOperatorValue.UNASSIGNED:
        return isNull(schema.Thread.assigneeId)

      case IsOperatorValue.UNREPLIED:
        // Messages where only the first one is from external sources (no replies from our side)
        return and(
          // At least one message exists
          exists(
            database
              .select()
              .from(schema.Message)
              .where(eq(schema.Message.threadId, schema.Thread.id))
          ),
          // All messages are either first in thread or inbound
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.Message}
            WHERE ${schema.Message.threadId} = ${schema.Thread.id}
            AND ${schema.Message.isFirstInThread} = false
            AND ${schema.Message.isInbound} = false
          )`
        )

      default:
        logger.warn(`Unknown 'is:' value: ${value}`)
        return undefined
    }
  }

  /**
   * Builds a condition for tag search.
   * @param value - The tag name.
   * @returns {SQL | undefined} The condition.
   */
  /**
   * Build tag condition using FieldValue relationship.
   * Supports "no-tags" special value and searches by tag title or ID.
   */
  private buildTagCondition(value: string): SQL | undefined {
    if (value.toLowerCase() === 'no-tags') {
      return threadHasNoTags(database, schema.Thread.id, this.input.organizationId)
    }

    // Search by tag title or ID using FieldValue relationship
    return threadHasTagMatchingSearch(database, schema.Thread.id, value, this.input.organizationId)
  }

  /**
   * Builds a condition for inbox search.
   * @param value - The inbox name.
   * @returns {SQL | undefined} The condition.
   */
  private buildInboxCondition(value: string): SQL | undefined {
    // Note: Thread.inboxId was removed in migration 0028
    // Filter by inbox through InboxIntegration join
    return exists(
      database
        .select()
        .from(schema.InboxIntegration)
        .innerJoin(schema.Inbox, eq(schema.Inbox.id, schema.InboxIntegration.inboxId))
        .where(
          and(
            eq(schema.InboxIntegration.integrationId, schema.Thread.integrationId),
            or(ilike(schema.Inbox.name, `%${value}%`), eq(schema.Inbox.id, value))
          )
        )
    )
  }

  private buildContactCondition(role: string, value: string): SQL | undefined {
    return exists(
      database
        .select()
        .from(schema.Message)
        .innerJoin(
          schema.MessageParticipant,
          eq(schema.MessageParticipant.messageId, schema.Message.id)
        )
        .innerJoin(
          schema.Participant,
          eq(schema.Participant.id, schema.MessageParticipant.participantId)
        )
        .where(
          and(
            eq(schema.Message.threadId, schema.Thread.id),
            eq(schema.MessageParticipant.role, role as any),
            or(
              ilike(schema.Participant.identifier, `%${value}%`),
              ilike(schema.Participant.displayName, `%${value}%`),
              ilike(schema.Participant.name, `%${value}%`)
            )
          )
        )
    )
  }

  /**
   * Builds a condition for date-based searches (before, after, during).
   * @param operator - The date operator (before, after, during).
   * @param value - The date string value.
   * @returns {SQL | undefined} The condition.
   */
  private buildDateCondition(operator: string, value: string): SQL | undefined {
    try {
      // Parse the date value
      let date: Date

      // Handle special values like "today", "yesterday", "thisweek"
      switch (value.toLowerCase()) {
        case 'today':
          date = new Date()
          date.setHours(0, 0, 0, 0)
          break
        case 'yesterday':
          date = new Date()
          date.setDate(date.getDate() - 1)
          date.setHours(0, 0, 0, 0)
          break
        case 'thisweek':
          date = new Date()
          date.setDate(date.getDate() - date.getDay()) // Go to start of week (Sunday)
          date.setHours(0, 0, 0, 0)
          break
        case 'lastweek':
          date = new Date()
          date.setDate(date.getDate() - date.getDay() - 7) // Go to start of last week
          date.setHours(0, 0, 0, 0)
          break
        case 'thismonth':
          date = new Date()
          date.setDate(1) // First day of the month
          date.setHours(0, 0, 0, 0)
          break
        case 'lastmonth':
          date = new Date()
          date.setMonth(date.getMonth() - 1) // Previous month
          date.setDate(1) // First day of the previous month
          date.setHours(0, 0, 0, 0)
          break
        default:
          // Try parsing as ISO date string (YYYY-MM-DD)
          date = new Date(value)
          if (isNaN(date.getTime())) {
            throw new Error(`Invalid date format: ${value}`)
          }
      }

      // Build the date condition based on the operator
      switch (operator.toLowerCase()) {
        case 'before':
          return lt(schema.Thread.lastMessageAt, date)
        case 'after':
          return gt(schema.Thread.lastMessageAt, date)
        case 'during':
          // For "during:2022-05", handle year-month format (YYYY-MM)
          if (/^\d{4}-\d{2}$/.test(value)) {
            const [year, month] = value.split('-').map((v) => parseInt(v, 10))
            const startDate = new Date(year, month - 1, 1) // Month is 0-indexed in JS Date
            const endDate = new Date(year, month, 0) // Last day of the month
            endDate.setHours(23, 59, 59, 999)

            return and(
              gte(schema.Thread.lastMessageAt, startDate),
              lte(schema.Thread.lastMessageAt, endDate)
            )
          }
          // For "during:2022", handle year format (YYYY)
          else if (/^\d{4}$/.test(value)) {
            const year = parseInt(value, 10)
            const startDate = new Date(year, 0, 1) // January 1st
            const endDate = new Date(year, 11, 31, 23, 59, 59, 999) // December 31st

            return and(
              gte(schema.Thread.lastMessageAt, startDate),
              lte(schema.Thread.lastMessageAt, endDate)
            )
          }
          // For specific date "during:2022-05-15"
          else {
            const endOfDay = new Date(date)
            endOfDay.setHours(23, 59, 59, 999)

            return and(
              gte(schema.Thread.lastMessageAt, date),
              lte(schema.Thread.lastMessageAt, endOfDay)
            )
          }
        default:
          logger.warn(`Unknown date operator: ${operator}`)
          return undefined
      }
    } catch (error) {
      logger.warn(`Error parsing date condition`, {
        operator,
        value,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  /**
   * Builds a condition for author search (messages created by a user).
   * @param value - The author name or email.
   * @returns {SQL | undefined} The condition.
   */
  private buildAuthorCondition(value: string): SQL | undefined {
    // Special handling for "me" value when userId is available
    if (value.toLowerCase() === 'me' && this.input.userId) {
      return exists(
        database
          .select()
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.threadId, schema.Thread.id),
              eq(schema.Message.createdById, this.input.userId)
            )
          )
      )
    }

    return exists(
      database
        .select()
        .from(schema.Message)
        .innerJoin(schema.User, eq(schema.User.id, schema.Message.createdById))
        .where(
          and(
            eq(schema.Message.threadId, schema.Thread.id),
            or(ilike(schema.User.name, `%${value}%`), ilike(schema.User.email, `%${value}%`))
          )
        )
    )
  }

  /**
   * Builds a condition for "with" search (involved in any way).
   * @param value - The person name or email.
   * @returns {SQL | undefined} The condition.
   */
  private buildWithCondition(value: string): SQL | undefined {
    // Special handling for "me" value when userId is available
    if (value.toLowerCase() === 'me' && this.input.userId) {
      return or(
        // Assigned to me
        eq(schema.Thread.assigneeId, this.input.userId),
        // Author is me
        exists(
          database
            .select()
            .from(schema.Message)
            .where(
              and(
                eq(schema.Message.threadId, schema.Thread.id),
                eq(schema.Message.createdById, this.input.userId)
              )
            )
        ),
        // Participant is me (Note: Contact.userId relationship needs schema verification)
        exists(
          database
            .select()
            .from(schema.Message)
            .innerJoin(
              schema.MessageParticipant,
              eq(schema.MessageParticipant.messageId, schema.Message.id)
            )
            .innerJoin(
              schema.Participant,
              eq(schema.Participant.id, schema.MessageParticipant.participantId)
            )
            .where(
              and(
                eq(schema.Message.threadId, schema.Thread.id)
                // TODO: Add proper user-participant relationship check
              )
            )
        )
      )
    }

    // General case: search across multiple involvement types
    return or(
      // Assigned to this person
      exists(
        database
          .select()
          .from(schema.User)
          .where(
            and(
              eq(schema.User.id, schema.Thread.assigneeId),
              or(ilike(schema.User.name, `%${value}%`), ilike(schema.User.email, `%${value}%`))
            )
          )
      ),
      // Created by this person
      exists(
        database
          .select()
          .from(schema.Message)
          .innerJoin(schema.User, eq(schema.User.id, schema.Message.createdById))
          .where(
            and(
              eq(schema.Message.threadId, schema.Thread.id),
              or(ilike(schema.User.name, `%${value}%`), ilike(schema.User.email, `%${value}%`))
            )
          )
      ),
      // Participant (from, to, cc, bcc)
      exists(
        database
          .select()
          .from(schema.Message)
          .innerJoin(
            schema.MessageParticipant,
            eq(schema.MessageParticipant.messageId, schema.Message.id)
          )
          .innerJoin(
            schema.Participant,
            eq(schema.Participant.id, schema.MessageParticipant.participantId)
          )
          .where(
            and(
              eq(schema.Message.threadId, schema.Thread.id),
              or(
                ilike(schema.Participant.identifier, `%${value}%`),
                ilike(schema.Participant.displayName, `%${value}%`),
                ilike(schema.Participant.name, `%${value}%`)
              )
            )
          )
      )
    )
  }

  /**
   * Builds a condition for recipient search (to, cc, or bcc).
   * @param value - The recipient name or email.
   * @returns {SQL | undefined} The condition.
   */
  private buildRecipientCondition(value: string): SQL | undefined {
    return exists(
      database
        .select()
        .from(schema.Message)
        .innerJoin(
          schema.MessageParticipant,
          eq(schema.MessageParticipant.messageId, schema.Message.id)
        )
        .innerJoin(
          schema.Participant,
          eq(schema.Participant.id, schema.MessageParticipant.participantId)
        )
        .where(
          and(
            eq(schema.Message.threadId, schema.Thread.id),
            inArray(schema.MessageParticipant.role, ['TO', 'CC', 'BCC'] as any),
            or(
              ilike(schema.Participant.identifier, `%${value}%`),
              ilike(schema.Participant.displayName, `%${value}%`),
              ilike(schema.Participant.name, `%${value}%`)
            )
          )
        )
    )
  }

  /**
   * Builds a condition for "has:" searches.
   * @param value - The feature to check for.
   * @returns {SQL | undefined} The condition.
   */
  private buildHasCondition(value: string): SQL | undefined {
    const hasValue = value.toLowerCase()

    switch (hasValue) {
      case 'no-tags':
        return threadHasNoTags(database, schema.Thread.id, this.input.organizationId)
      case 'attachments':
        return exists(
          database
            .select()
            .from(schema.Message)
            .where(
              and(
                eq(schema.Message.threadId, schema.Thread.id),
                eq(schema.Message.hasAttachments, true)
              )
            )
        )
      case 'no-assignee':
        return isNull(schema.Thread.assigneeId)
      default:
        logger.warn(`Unknown 'has:' value: ${value}`)
        return undefined
    }
  }

  /**
   * Builds a condition for message type search.
   * Uses the new query helpers to filter by provider (derived from Integration table).
   * @param value - The message type or provider name.
   * @returns {SQL | undefined} The condition.
   */
  private buildTypeCondition(value: string): SQL | undefined {
    const typeValue = value.toLowerCase()

    // Try to match message types first
    const messageTypeMap: Record<string, MessageType> = {
      email: 'EMAIL',
      chat: 'CHAT',
      facebook: 'FACEBOOK',
      instagram: 'INSTAGRAM',
      sms: 'SMS',
      whatsapp: 'WHATSAPP',
    }

    if (messageTypeMap[typeValue]) {
      return whereThreadMessageType(messageTypeMap[typeValue])
    }

    // Try to match against legacy integration types (uppercase)
    const upperValue = value.toUpperCase()
    const validIntegrationTypes = [
      'GOOGLE',
      'OUTLOOK',
      'OPENPHONE',
      'FACEBOOK',
      'INSTAGRAM',
      'CHAT',
    ]

    if (validIntegrationTypes.includes(upperValue)) {
      const provider = integrationTypeToProvider(upperValue)
      return whereThreadProvider(provider)
    }

    logger.warn(`Unknown message/integration type: ${value}`)
    return undefined
  }
}
