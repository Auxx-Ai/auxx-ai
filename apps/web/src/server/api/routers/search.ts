import { schema } from '@auxx/database'
import { ParticipantRole } from '@auxx/database/enums'
import { InboxService } from '@auxx/lib/inboxes'
import { IsOperatorValue, SearchOperator } from '@auxx/lib/mail-query'
import { listMembersWithUser } from '@auxx/lib/members'
import { listAll } from '@auxx/lib/resources'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count as drizzleCount, eq, ilike, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('search-router')

/** Schema for search conditions stored in recent searches */
const searchConditionSchema = z.object({
  fieldId: z.string(),
  operator: z.string(),
  value: z.any(),
})
// Helper function to get operator description
const getOperatorDescription = (operator: string): string => {
  const descriptions: Record<string, string> = {
    [SearchOperator.ASSIGNEE]: 'Filter by assignee',
    [SearchOperator.AUTHOR]: 'Filter by author',
    [SearchOperator.WITH]: 'Filter messages with participant',
    [SearchOperator.SUBJECT]: 'Search in subject',
    [SearchOperator.BODY]: 'Search in message body',
    [SearchOperator.INBOX]: 'Filter by inbox',
    [SearchOperator.TYPE]: 'Filter by type',
    [SearchOperator.IS]: 'Filter by status',
    [SearchOperator.TAG]: 'Filter by tag',
    [SearchOperator.HAS]: 'Filter by properties',
    [SearchOperator.BEFORE]: 'Messages before date',
    [SearchOperator.AFTER]: 'Messages after date',
    [SearchOperator.DURING]: 'Messages during period',
    [SearchOperator.FROM]: 'Filter by sender',
    [SearchOperator.TO]: 'Filter by recipient',
    [SearchOperator.CC]: 'Filter by CC',
    [SearchOperator.BCC]: 'Filter by BCC',
    [SearchOperator.RECIPIENT]: 'Filter by any recipient',
    participants: 'Filter by any participant',
  }
  return descriptions[operator] || ''
}
// Helper function to get status description
const getStatusDescription = (status: string): string => {
  const descriptions: Record<string, string> = {
    [IsOperatorValue.ARCHIVED]: 'Archived messages',
    [IsOperatorValue.UNREAD]: 'Unread messages',
    [IsOperatorValue.OPEN]: 'Open messages',
    [IsOperatorValue.UNREPLIED]: 'Messages needing reply',
    [IsOperatorValue.SPAM]: 'Spam messages',
    [IsOperatorValue.TRASHED]: 'Trashed messages',
    [IsOperatorValue.ASSIGNED]: 'Assigned messages',
    [IsOperatorValue.UNASSIGNED]: 'Unassigned messages',
  }
  return descriptions[status] || ''
}
// Helper function to get display name with entity instance (contact) priority
const getParticipantDisplayName = (participant: any) => {
  // Try entityInstance (was contact before migration)
  const entity = participant.entityInstance || participant.contact
  if (entity) {
    const contactName = [entity.firstName, entity.lastName].filter(Boolean).join(' ')
    if (contactName) return contactName
  }
  return participant.displayName || participant.name || participant.identifier
}
// Helper function to save search query with limit management
const saveSearchQuery = async (ctx: any, query: string) => {
  const userId = ctx.session.userId
  const organizationId = ctx.session.organizationId
  try {
    // First, clean up old entries if we're at the limit
    const [countRow] = await ctx.db
      .select({ value: drizzleCount() })
      .from(schema.SearchHistory)
      .where(
        and(
          eq(schema.SearchHistory.organizationId, organizationId),
          eq(schema.SearchHistory.userId, userId)
        )
      )
    const existingCount = countRow?.value ?? 0
    if (existingCount >= 20) {
      // Delete oldest entries
      const oldestEntries = await ctx.db
        .select({ id: schema.SearchHistory.id })
        .from(schema.SearchHistory)
        .where(
          and(
            eq(schema.SearchHistory.organizationId, organizationId),
            eq(schema.SearchHistory.userId, userId)
          )
        )
        .orderBy(asc(schema.SearchHistory.searchedAt))
        .limit(existingCount - 19)
      if (oldestEntries.length) {
        await ctx.db.delete(schema.SearchHistory).where(
          inArray(
            schema.SearchHistory.id,
            oldestEntries.map((e: any) => e.id)
          )
        )
      }
    }
    // Save new search
    await ctx.db.insert(schema.SearchHistory).values({
      userId,
      organizationId,
      query,
    })
  } catch (error) {
    logger.error('Failed to save search history', { error, query })
    // Don't throw - search history is non-critical
  }
}
export const searchRouter = createTRPCRouter({
  // Main search endpoint (keeping for backward compatibility)
  search: protectedProcedure
    .input(z.object({ accountId: z.string(), query: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [acc] = await ctx.db
        .select({ id: schema.account.id, userId: schema.account.userId })
        .from(schema.account)
        .where(eq(schema.account.id, input.accountId))
        .limit(1)
      if (!acc || acc.userId !== ctx.session.userId) throw new Error('Invalid token')
      // Save search query
      await saveSearchQuery(ctx, input.query)
      return { hits: [] }
    }),
  // Search suggestions endpoint
  suggestions: protectedProcedure
    .input(
      z.object({
        operator: z.string().optional(),
        query: z.string(),
        context: z
          .object({
            inboxId: z.string().optional(),
            currentFilters: z.record(z.string(), z.any()).optional(),
          })
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { operator, query } = input
      const userId = ctx.session.userId
      const organizationId = ctx.session.organizationId
      const suggestions: any[] = []
      // If no operator, suggest operators and recent searches
      if (!operator) {
        // Add operator suggestions if query matches
        if (!query || query.length === 0) {
          // Show recent searches when focused without input
          const recents = await ctx.db
            .select()
            .from(schema.SearchHistory)
            .where(eq(schema.SearchHistory.organizationId, organizationId))
            .limit(20)
          const seen = new Set<string>()
          const recentDistinct = [] as any[]
          for (const r of recents) {
            const q = (r as any).query
            if (!seen.has(q)) {
              seen.add(q)
              recentDistinct.push(r)
            }
            if (recentDistinct.length >= 5) break
          }
          suggestions.push(
            ...recentDistinct.map((s: any) => ({
              type: 'recent',
              value: s.query,
              label: s.query,
              icon: 'history',
            }))
          )
        }
        // Add operator suggestions
        const operators = Object.values(SearchOperator)
        const matchingOperators = operators.filter((op) =>
          op.toLowerCase().startsWith(query.toLowerCase())
        )
        suggestions.push(
          ...matchingOperators.map((op) => ({
            type: 'operator',
            value: `${op}:`,
            label: `${op}:`,
            description: getOperatorDescription(op),
          }))
        )
        return suggestions
      }
      // Operator-specific suggestions
      switch (operator.toLowerCase()) {
        case SearchOperator.ASSIGNEE: {
          // Get team members
          const members = await listMembersWithUser(organizationId, {
            nameOrEmailContains: query,
            limit: 20,
          })
          suggestions.push(
            ...members.map((m: any) => ({
              type: 'user',
              value: m.user.email,
              label: m.user.name || m.user.email,
              image: m.user.image,
              secondary: m.user.email,
            }))
          )
          break
        }
        case SearchOperator.FROM:
        case SearchOperator.TO:
        case SearchOperator.CC:
        case SearchOperator.RECIPIENT:
        case SearchOperator.WITH:
        case 'participants': {
          const participants = await ctx.db
            .select()
            .from(schema.Participant)
            .where(
              and(
                eq(schema.Participant.organizationId, organizationId),
                query
                  ? or(
                      ilike(schema.Participant.identifier, `%${query}%`),
                      ilike(schema.Participant.name, `%${query}%`),
                      ilike(schema.Participant.displayName, `%${query}%`)
                    )
                  : undefined
              )
            )
            .limit(10)
          suggestions.push(
            ...participants.map((p: any) => ({
              type: 'participant',
              value: p.identifier,
              label: getParticipantDisplayName(p),
              secondary: p.identifier,
            }))
          )
          break
        }
        case SearchOperator.TAG: {
          // Get tags using unified entity system
          const result = await listAll({
            organizationId,
            userId,
            db: ctx.db,
            entityDefinitionId: 'tag',
          })
          const filteredTags = result.items
            .filter((item) => {
              const title = item.fieldValues.title ?? item.displayName ?? ''
              return !query || title.toLowerCase().includes(query.toLowerCase())
            })
            .slice(0, 10)
          suggestions.push(
            ...filteredTags.map((item) => ({
              type: 'tag',
              value: item.fieldValues.title ?? item.displayName ?? '',
              label: item.fieldValues.title ?? item.displayName ?? '',
              emoji: item.fieldValues.tag_emoji ?? null,
              color: item.fieldValues.tag_color ?? null,
            }))
          )
          break
        }
        case SearchOperator.INBOX: {
          // Get user's accessible inboxes
          const inboxService = new InboxService(ctx.db, organizationId)
          const inboxes = await inboxService.getInboxesForUser(userId)
          const filteredInboxes = inboxes
            .filter((inbox) => !query || inbox.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 10)
          suggestions.push(
            ...filteredInboxes.map((inbox) => ({
              type: 'inbox',
              value: inbox.name,
              label: inbox.name,
              color: inbox.color,
            }))
          )
          break
        }
        case SearchOperator.IS: {
          // Get status values
          const statuses = Object.values(IsOperatorValue)
          const filteredStatuses = statuses.filter(
            (status) => !query || status.toLowerCase().includes(query.toLowerCase())
          )
          suggestions.push(
            ...filteredStatuses.map((status) => ({
              type: 'status',
              value: status,
              label: status.charAt(0).toUpperCase() + status.slice(1),
              description: getStatusDescription(status),
            }))
          )
          break
        }
        case SearchOperator.HAS: {
          // Has operator values
          const hasValues = ['attachments', 'no-tags', 'no-assignee']
          const filteredValues = hasValues.filter(
            (val) => !query || val.includes(query.toLowerCase())
          )
          suggestions.push(
            ...filteredValues.map((val) => ({
              type: 'has',
              value: val,
              label: val.split('-').join(' '),
            }))
          )
          break
        }
      }
      return suggestions
    }),
  // Participant search endpoint
  participants: protectedProcedure
    .input(
      z.object({
        query: z.string(),
        type: z.enum(['from', 'to', 'cc', 'any']).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { query, type } = input
      const organizationId = ctx.session.organizationId
      // Build role filter based on type
      let roleFilter = {}
      if (type && type !== 'any') {
        const roleMap = {
          from: ParticipantRole.FROM,
          to: ParticipantRole.TO,
          cc: ParticipantRole.CC,
        }
        roleFilter = { role: roleMap[type] }
      }
      const participants = await ctx.db
        .select()
        .from(schema.Participant)
        .where(
          and(
            eq(schema.Participant.organizationId, organizationId),
            query
              ? or(
                  ilike(schema.Participant.identifier, `%${query}%`),
                  ilike(schema.Participant.name, `%${query}%`),
                  ilike(schema.Participant.displayName, `%${query}%`)
                )
              : undefined
          )
        )
        .limit(20)
      return participants.map((p: any) => ({
        id: p.id,
        identifier: p.identifier,
        displayName: getParticipantDisplayName(p),
        identifierType: p.identifierType,
        contactId: p.entityInstanceId,
        contact: p.contact || null,
      }))
    }),
  // Save search query (called when user executes a search) - DEPRECATED
  saveQuery: protectedProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await saveSearchQuery(ctx, input.query)
      return { success: true }
    }),

  // ─────────────────────────────────────────────────────────────────
  // NEW: Condition-based recent searches
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get recent searches with stored conditions
   * Returns conditions as JSON for restoring full filter state
   * Supports both new condition-based format and legacy text format
   */
  recentSearches: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.userId
    const organizationId = ctx.session.organizationId

    try {
      const recents = await ctx.db
        .select()
        .from(schema.SearchHistory)
        .where(eq(schema.SearchHistory.organizationId, organizationId))
        .limit(20)

      // Parse and deduplicate
      const seen = new Set<string>()
      const uniqueRecents = []

      for (const r of recents) {
        const query = (r as any).query || ''

        // Check if it's a condition-based search (new format)
        if (query.startsWith('__CONDITIONS__')) {
          try {
            const jsonStr = query.slice('__CONDITIONS__'.length)
            const data = JSON.parse(jsonStr)
            const displayText = data.displayText || ''

            if (!seen.has(displayText)) {
              seen.add(displayText)
              uniqueRecents.push({
                id: (r as any).id,
                displayText,
                conditions: data.conditions || [],
                conditionCount: Array.isArray(data.conditions) ? data.conditions.length : 0,
                createdAt: (r as any).createdAt,
              })
            }
          } catch {
            // Skip malformed entries
            continue
          }
        } else {
          // Legacy text-based search - skip for now
          // These don't have restorable conditions
          continue
        }

        if (uniqueRecents.length >= 5) break
      }

      return uniqueRecents
    } catch (error) {
      logger.error('Failed to fetch recent searches', { error })
      return []
    }
  }),

  /**
   * Save search with conditions (new format)
   * Stores conditions as JSON in the query field for now
   * TODO: Add proper conditions JSONB column to SearchHistory table
   */
  saveSearch: protectedProcedure
    .input(
      z.object({
        conditions: z.array(searchConditionSchema),
        displayText: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session.userId
      const organizationId = ctx.session.organizationId

      try {
        // Clean up old entries if at limit
        const [countRow] = await ctx.db
          .select({ value: drizzleCount() })
          .from(schema.SearchHistory)
          .where(
            and(
              eq(schema.SearchHistory.organizationId, organizationId),
              eq(schema.SearchHistory.userId, userId)
            )
          )
        const existingCount = countRow?.value ?? 0
        if (existingCount >= 20) {
          const oldestEntries = await ctx.db
            .select({ id: schema.SearchHistory.id })
            .from(schema.SearchHistory)
            .where(
              and(
                eq(schema.SearchHistory.organizationId, organizationId),
                eq(schema.SearchHistory.userId, userId)
              )
            )
            .orderBy(asc(schema.SearchHistory.searchedAt))
            .limit(existingCount - 19)
          if (oldestEntries.length) {
            await ctx.db.delete(schema.SearchHistory).where(
              inArray(
                schema.SearchHistory.id,
                oldestEntries.map((e: any) => e.id)
              )
            )
          }
        }

        // Store as JSON string with special prefix to identify condition-based searches
        const searchData = JSON.stringify({
          displayText: input.displayText,
          conditions: input.conditions,
        })
        await ctx.db.insert(schema.SearchHistory).values({
          userId,
          organizationId,
          query: `__CONDITIONS__${searchData}`,
        })
        return { success: true }
      } catch (error) {
        logger.error('Failed to save search', { error })
        return { success: false }
      }
    }),
})
