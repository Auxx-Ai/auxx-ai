import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '../trpc'
import {
  SearchHistoryModel,
  accountModel,
  OrganizationMemberModel,
  ParticipantModel,
} from '@auxx/database/models'
import { TagService } from '@auxx/lib/tags'
import { InboxService } from '@auxx/lib/inboxes'
import { schema } from '@auxx/database'
import { and, or, eq, ilike, inArray } from 'drizzle-orm'
import { SearchOperator, IsOperatorValue } from '@auxx/lib/mail-query'
import { createScopedLogger } from '@auxx/logger'
import { ParticipantRole } from '@auxx/database/enums'

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
// Helper function to get display name with Contact priority
const getParticipantDisplayName = (participant: any) => {
  if (participant.contact) {
    const contactName = [participant.contact.firstName, participant.contact.lastName]
      .filter(Boolean)
      .join(' ')
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
    const model = new SearchHistoryModel(organizationId)
    const existingCountRes = await model.countByUser(userId)
    const existingCount = existingCountRes.ok ? existingCountRes.value : 0
    if (existingCount >= 20) {
      // Delete oldest entries
      const oldestRes = await model.findOldestByUser(userId, existingCount - 19)
      const oldestEntries = oldestRes.ok ? oldestRes.value : []
      if (oldestEntries.length) {
        await model.deleteMany(oldestEntries.map((e: any) => e.id))
      }
    }
    // Save new search
    await model.createForUser(userId, query)
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
      const accModel = new accountModel()
      const accRes = await accModel.findById(input.accountId)
      const account =
        accRes.ok && accRes.value && (accRes.value as any).userId === ctx.session.userId
          ? accRes.value
          : null
      if (!account) throw new Error('Invalid token')
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
          const model = new SearchHistoryModel(organizationId)
          const recentRes = await model.findMany({ orderBy: undefined as any, limit: 20 })
          const recents = recentRes.ok ? recentRes.value : []
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
          // Get team members via model
          const om = new OrganizationMemberModel(organizationId)
          const mres = await om.listWithUser({ nameOrEmailContains: query, limit: 20 })
          const members = mres.ok ? mres.value : []
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
          const pModel = new ParticipantModel(organizationId)
          const pres = await pModel.listSuggestions(query, 10)
          const participants = pres.ok ? pres.value : []
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
          // Get tags
          const tagService = new TagService(organizationId, userId, ctx.db)
          const tags = await tagService.getAllTags()
          const filteredTags = tags
            .filter((tag) => !query || tag.title.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 10)
          suggestions.push(
            ...filteredTags.map((tag) => ({
              type: 'tag',
              value: tag.title,
              label: tag.title,
              emoji: tag.emoji,
              color: tag.color,
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
      // Use ParticipantModel for complex search since it handles the organization scoping
      const pModel = new ParticipantModel(organizationId)
      const searchRes = await pModel.listSuggestions(query, 20)
      const participants = searchRes.ok ? searchRes.value : []
      return participants.map((p: any) => ({
        id: p.id,
        identifier: p.identifier,
        displayName: getParticipantDisplayName(p),
        identifierType: p.identifierType,
        contactId: p.contactId,
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
      const model = new SearchHistoryModel(organizationId)
      const recentRes = await model.findMany({ orderBy: undefined as any, limit: 20 })
      const recents = recentRes.ok ? recentRes.value : []

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
        const model = new SearchHistoryModel(organizationId)

        // Clean up old entries if at limit
        const existingCountRes = await model.countByUser(userId)
        const existingCount = existingCountRes.ok ? existingCountRes.value : 0
        if (existingCount >= 20) {
          const oldestRes = await model.findOldestByUser(userId, existingCount - 19)
          const oldestEntries = oldestRes.ok ? oldestRes.value : []
          if (oldestEntries.length) {
            await model.deleteMany(oldestEntries.map((e: any) => e.id))
          }
        }

        // Store as JSON string with special prefix to identify condition-based searches
        // Format: __CONDITIONS__:{displayText}:{conditionsJSON}
        const searchData = JSON.stringify({
          displayText: input.displayText,
          conditions: input.conditions,
        })
        await model.createForUser(userId, `__CONDITIONS__${searchData}`)
        return { success: true }
      } catch (error) {
        logger.error('Failed to save search', { error })
        return { success: false }
      }
    }),
})
