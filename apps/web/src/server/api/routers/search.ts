import { schema } from '@auxx/database'
import { InboxService } from '@auxx/lib/inboxes'
import { IsOperatorValue, SearchOperator } from '@auxx/lib/mail-query'
import { listMembersWithUser } from '@auxx/lib/members'
import { PermissionKey } from '@auxx/lib/permissions'
import { listAll } from '@auxx/lib/resources'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, count as drizzleCount, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter, protectedProcedure } from '../trpc'

const logger = createScopedLogger('search-router')

/** Schema for search conditions stored in recent searches */
const searchConditionSchema = z.object({
  id: z.string().optional(),
  fieldId: z.string(),
  operator: z.string(),
  value: z.any(),
  displayLabel: z.string().optional(),
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
  suggestions: capabilityProcedure
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
          // Read enforcement: `Participant` is an ORG-WIDE table of every email /
          // phone identity that has ever touched the org, with no inbox column and
          // no mail lens — so an ungated ILIKE here answered "has this address ever
          // corresponded with anyone in this org?" for any authenticated member,
          // including addresses that only ever appeared in someone else's PERSONAL
          // mailbox. These are mail-search operators, so the coarse mail door is the
          // right bar, and it is the SAME primitive every mail router asserts
          // (`const mailProcedure = permissionProcedure(PermissionKey.inboxesView)`
          // in thread/message/draft/label/inbox/mailView — and in `participant.ts`,
          // whose `getByIds` was already gated while this sibling read was not).
          //
          // `can()` reads `keys ∪ instanceDerivedKeys`, which is the front-door
          // union rather than the area level — so a member whose profile closes
          // `Area.inboxes` but who holds an explicit grant on ONE inbox still
          // passes, which is correct: they do have mail reach.
          //
          // ⚠ This is a COARSE gate and does not claim to be more. A member with
          // one narrow inbox can still probe addresses drawn from threads their
          // lens hides — narrowing to participants on lens-admitted threads is the
          // tight answer and is deliberately NOT attempted here.
          //
          // `break` rather than throw, matching the `TAG` branch below: this is one
          // operator of a shared autocomplete, and a mail-closed member using
          // `tag:` must still get their suggestions.
          if (!ctx.capabilities.can(PermissionKey.inboxesView)) break
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
          // Read enforcement (§2.1): skip tag suggestions if the def is restricted.
          if (!ctx.capabilities.canViewEntity('tag')) break
          // Get tags using unified entity system
          const result = await listAll(
            {
              organizationId,
              userId,
              db: ctx.db,
              // Threaded per plan v3/03 §5.4 — the def gate above is not enough:
              // without this the `FieldValueService` inside `listAll` reads tag
              // field values unenforced.
              capabilities: ctx.capabilities,
            },
            {
              entityDefinitionId: 'tag',
              fieldKeys: ['title', 'tag_emoji', 'tag_color'],
            }
          )
          // `ListAllItem.fieldValues` is `Record<string, unknown>` — narrow to a
          // string instead of assuming, so a non-text value can never reach
          // `.toLowerCase()`.
          const asString = (value: unknown): string | null =>
            typeof value === 'string' ? value : null
          const tagTitle = (item: (typeof result.items)[number]) =>
            asString(item.fieldValues.title) ?? item.displayName ?? ''
          const filteredTags = result.items
            .filter((item) => !query || tagTitle(item).toLowerCase().includes(query.toLowerCase()))
            .slice(0, 10)
          suggestions.push(
            ...filteredTags.map((item) => ({
              type: 'tag',
              value: tagTitle(item),
              label: tagTitle(item),
              emoji: asString(item.fieldValues.tag_emoji),
              color: asString(item.fieldValues.tag_color),
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
  /**
   * Participant search endpoint — the recipient/participant typeahead.
   *
   * Gated on the same coarse mail door as the `FROM`/`TO`/`CC`/`RECIPIENT`/`WITH`
   * branch of {@link suggestions}, and for the same reason: this is the identical
   * org-wide `Participant` ILIKE, just reached through its own procedure. It was a
   * bare `protectedProcedure` — no capability set in `ctx` at all — so gating it
   * required promoting it to `capabilityProcedure` first.
   *
   * `assert` rather than `break` here, unlike the suggestions branch: this
   * procedure serves ONLY participants, so there is no sibling operator whose
   * results a silent empty list would have to preserve. A 403 is the honest answer.
   */
  participants: capabilityProcedure
    .input(
      z.object({
        query: z.string(),
        /**
         * Accepted and IGNORED. A `Participant` row has no role — role lives on
         * `MessageParticipant`, per message — so "addresses that have ever been
         * a FROM" would be a different query over a different table. This used
         * to build a `roleFilter` object that was never referenced in the
         * `where`; the parameter stays only because every caller passes it.
         */
        type: z.enum(['from', 'to', 'cc', 'any']).optional(),
        /**
         * Narrow to these identifier types — how a phone-only surface stops
         * suggesting email addresses. Omitted means every type.
         */
        identifierTypes: z
          .array(z.enum(['EMAIL', 'PHONE', 'FACEBOOK_PSID', 'INSTAGRAM_IGSID', 'CHAT_VISITOR']))
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      ctx.capabilities.assert(PermissionKey.inboxesView)
      const { query, identifierTypes } = input
      const organizationId = ctx.session.organizationId
      const participants = await ctx.db
        .select()
        .from(schema.Participant)
        .where(
          and(
            eq(schema.Participant.organizationId, organizationId),
            identifierTypes && identifierTypes.length > 0
              ? inArray(schema.Participant.identifierType, identifierTypes)
              : undefined,
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
  /**
   * Ranked recipient search for the composer — participants ∪ contacts.
   *
   * Replaces the composer's contact-record picker, which searched records and then
   * reconstructed identifiers on the client. One `Participant` row IS one
   * identifier, so searching that collapses the per-record fan-out; the contact arm
   * covers the people never corresponded with, whom `Participant` has no row for.
   *
   * 🔴 **Two arms, two gates, deliberately not flattened.** The participant arm is
   * mail data and narrows with the mail lens; the contact arm is CRM data and
   * narrows with record scope. A viewer can legitimately see one and not the other,
   * and the endpoint answers with whichever arm admits rows — the lib function is
   * built so a fully-excluding lens still returns contacts, and a `none` record
   * scope still returns participants. Merging the two authorization models is how a
   * permissions bug gets written (`text-search-sql.ts:14-19`).
   */
  recipients: capabilityProcedure
    .input(
      z.object({
        /** Empty switches to most-recently-mailed, the composer's focus state. */
        query: z.string(),
        /** `PlatformCapabilities.recipientModel` of the SENDING channel. */
        model: z.enum(['email', 'phone', 'thread_only', 'platform_user']),
        /**
         * ISO-3166 region for national (no `+`) phone input. The composer derives
         * it from the sending channel's own number (`regionFromIdentifier`) — the
         * same digits mean different numbers in different regions, and the org
         * profile cannot express a per-send answer.
         */
        region: z.string().length(2).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Same coarse mail door as `participants` above — this is the same
      // `Participant` corpus reached through a better query.
      ctx.capabilities.assert(PermissionKey.inboxesView)

      // 🔴 Lazy imports, and NOT a style choice. At module scope these pull
      // `@auxx/lib/cache`'s provider graph and `visibility-scope`'s
      // `import { database }`, both of which touch `schema` / the db singleton
      // while the module is being evaluated. That broke COLLECTION for every
      // router test that mocks `@auxx/database` — `search-participant-gate.test.ts`
      // went from 17 passing tests to 0 with `No "database" export is defined on
      // the "@auxx/database" mock`. Introduced by #1670 and missed because a suite
      // collecting zero tests does not read as a failure at a glance. Same reason
      // `@auxx/lib/apps` and the workflow engine are imported dynamically.
      const [
        { getCachedEntityDefId },
        { getCachedUserInstanceGrants },
        { buildMailVisibilityPredicate },
        { searchRecipients },
        { resolveRecordVisibilityScope },
      ] = await Promise.all([
        import('@auxx/lib/cache/org-cache-helpers'),
        import('@auxx/lib/cache/user-cache-helpers'),
        import('@auxx/lib/mail-query/visibility-scope'),
        import('@auxx/lib/participants/search'),
        import('@auxx/lib/permissions'),
      ])
      const organizationId = ctx.session.organizationId
      const userId = ctx.session.user.id

      // Participant arm: the mail lens. `undefined` (SYSTEM) means unscoped and
      // emits no EXISTS at all; a user viewer is always scoped, admins included.
      const grants = await getCachedUserInstanceGrants(userId, organizationId)
      const threadVisibility = buildMailVisibilityPredicate(grants)

      // Contact arm: record scope, built against the `ei` alias the lib query uses.
      // A `PgColumn` would render `"EntityInstance"."id"`, which Postgres rejects
      // once the table is aliased.
      const contactDefId = await getCachedEntityDefId(organizationId, 'contact')
      const scope = contactDefId
        ? await resolveRecordVisibilityScope({
            organizationId,
            userId,
            entityDefinitionId: contactDefId,
            capabilities: ctx.capabilities,
            instanceIdColumn: sql.raw('ei."id"'),
          })
        : undefined
      // `null` is "no rows for this viewer" and skips the arm entirely; `undefined`
      // is "no narrowing needed". They are different answers and the lib function
      // treats them differently, so do not collapse them into one falsy check.
      const contactVisibility =
        scope === undefined ? undefined : scope.arm === 'none' ? null : scope.where

      const result = await searchRecipients(ctx.db, {
        organizationId,
        query: input.query,
        model: input.model,
        region: input.region as Parameters<typeof searchRecipients>[1]['region'],
        limit: input.limit,
        threadVisibility,
        contactVisibility,
      })
      if (result.isErr()) throw result.error
      return result.value
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

  /** Delete a recent search entry */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db
        .delete(schema.SearchHistory)
        .where(
          and(
            eq(schema.SearchHistory.id, input.id),
            eq(schema.SearchHistory.userId, ctx.session.userId)
          )
        )
      return { success: true }
    }),
})
