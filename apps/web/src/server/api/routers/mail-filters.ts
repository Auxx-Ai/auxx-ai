// apps/web/src/server/api/routers/mail-filters.ts

import { getCachedUserInstanceGrants, onCacheEvent } from '@auxx/lib/cache'
import type { ConditionGroup } from '@auxx/lib/conditions'
import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import {
  ACTION_REQUIRING_AUTOMATION_KEY,
  applyRetroactively,
  countBillableMailFilters,
  countPersonalMailFilters,
  createMailFilter,
  deleteMailFilter,
  findPendingRetroactivePrompt,
  getMailFilterById,
  getMailFilterRunById,
  listMailFilterRuns,
  listMailFilterRunsForThread,
  listMailFilters,
  loadBackfillableFilter,
  MAX_PERSONAL_MAIL_FILTERS,
  type MailFilterAction,
  previewMatchCount,
  reorderMailFilters,
  setMailFilterEnabled,
  undoMailFilterRun,
  updateMailFilter,
} from '@auxx/lib/mail-filters'
import { assertFilterConditionsCompile } from '@auxx/lib/mail-filters/evaluate'
import { FeatureKey, FeaturePermissionService } from '@auxx/lib/permissions'
import { getUserSetting, updateUserSetting } from '@auxx/lib/settings'
import { z } from 'zod'
import {
  assertCanAuthorMailFilters,
  loadMailFilterAuthority,
  type MailFilterAuthority,
} from '~/server/lib/mail-filter-authoring-access'
import { capabilityProcedure, createTRPCRouter } from '../trpc'

/**
 * tRPC surface for mail filters — Gmail-style "when a new message in this inbox
 * matches X, do Y" (plans/mail-filter/02-mail-filters-plan.md §5).
 *
 * Thin glue over `@auxx/lib/mail-filters`, per `record-rules.ts` and `label.ts`:
 * zod input → authorize → call a lib function → unwrap the `Result`. No
 * `try/catch` and no `TRPCError` — `auxxErrorMiddleware` maps every `AuxxError`
 * to the right status already.
 *
 * **Every procedure is `capabilityProcedure`, never
 * `permissionProcedure(automationRulesManage)`.** `capabilityProcedure` is
 * `protectedProcedure` plus a resolved `ctx.capabilities` and asserts NO key,
 * which is the point: the key is only one BRANCH of §5.1. A member filtering
 * their own personal mailbox holds no automation grant and must not need one, so
 * a procedure-level key gate would lock out the archetypal user of the feature.
 * The gate is inside, in `~/server/lib/mail-filter-authoring-access`.
 *
 * Invariant 11: the `settings/rules` page guard moves down to the sections, so
 * THIS ROUTER is the only authorization path left. `mail-filters.test.ts` pins
 * it.
 */

/** The nine `MailFilterAction` variants (§4.3), structurally. */
const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set-status'),
    status: z.enum(['OPEN', 'ARCHIVED', 'TRASH', 'SPAM']),
  }),
  z.object({ type: z.literal('add-tag'), tagIds: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('remove-tag'), tagIds: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal('assign'), assigneeId: z.string().min(1) }),
  z.object({ type: z.literal('set-read'), read: z.boolean() }),
  z.object({ type: z.literal('move-inbox'), inboxId: z.string().min(1) }),
  z.object({ type: z.literal('suppress-automations') }),
  z.object({
    type: z.literal('run-agent'),
    agentId: z.string().min(1),
    agentTriggerId: z.string().min(1),
  }),
  z.object({ type: z.literal('run-workflow'), workflowAppId: z.string().min(1) }),
])

/**
 * Conditions are validated STRUCTURALLY here and semantically in lib, the
 * `record-rules.ts` split: the shape is `ConditionGroup[]`, the same value the
 * searchbar and the mail views produce, and `condition-query-builder` is the one
 * thing that can say whether a given field/operator/value triple compiles. A
 * zod mirror of that grammar would be a second evaluator to keep in agreement
 * (invariant 5).
 *
 * The semantic half is NOT optional: `assertFilterConditionsCompile` runs on
 * every create and update below, because a dropped condition does not narrow a
 * filter — it WIDENS it, all the way to the whole inbox when every condition
 * drops (see `@auxx/lib/mail-filters/evaluate`).
 */
const conditionsSchema = z.array(z.unknown()).default([])

const filterInputSchema = z.object({
  name: z.string().min(1).max(200),
  conditions: conditionsSchema,
  actions: z.array(actionSchema).min(1),
  stopProcessing: z.boolean().default(false),
  enabled: z.boolean().default(true),
})

/**
 * The PATCH shape, spelled out rather than `filterInputSchema.partial()`.
 *
 * `.partial()` makes a key optional but KEEPS its `.default(...)`, so an update
 * carrying only `{ name }` still arrived at `updateMailFilter` with
 * `conditions: []`, `stopProcessing: false` and `enabled: true` — renaming a
 * filter wiped every condition (leaving a rule that matches every new message in
 * the inbox), cleared `stopProcessing` and switched a disabled filter back on.
 * `updateMailFilter` already writes only the keys it is given; absent has to mean
 * absent for that to hold.
 */
const filterPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(actionSchema).min(1).optional(),
  stopProcessing: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

/**
 * Invariant 15 — `run-agent` / `run-workflow` are rejected SERVER-SIDE for an
 * author without `automationRules.manage`, regardless of what the UI sent.
 *
 * Hiding them in the action catalog is not enough: those two enqueue org
 * automation that then runs AS THE ORG, so leaving them merely un-rendered turns
 * the unkeyed personal-filter door (§5.1's whole premise) into an unkeyed door
 * into org automation. Everything else only moves mail the author already
 * controls.
 */
function assertActionsAllowed(
  authority: MailFilterAuthority,
  actions: readonly { type: MailFilterAction['type'] }[]
): void {
  if (authority.hasAutomationKey) return
  const keyed = actions.find((action) => ACTION_REQUIRING_AUTOMATION_KEY.includes(action.type))
  if (keyed) {
    throw new ForbiddenError(
      `A '${keyed.type}' action needs permission to manage automation rules.`
    )
  }
}

/**
 * §4.3 / §5.1 — a `move-inbox` DESTINATION is authorized exactly like the
 * filter's own inbox, at save time, in addition to the fire-time existence check
 * in `@auxx/lib/mail-filters/actions`.
 *
 * Moving a conversation OUT of a personal mailbox is a sharing action: the
 * destination's readers gain mail they could not see, and the author gains a
 * standing write into a mailbox that is not theirs. Scoping the picker in the
 * dialog is not a gate — invariant 15 exists because "hidden in the catalog"
 * loses to a hand-rolled POST, and this is the same class of hole: without this
 * loop any member with a personal mailbox and no permission key could route
 * every matching message into a colleague's private inbox.
 *
 * Deliberately the SAME `assertCanAuthorMailFilters` the filter's own inbox goes
 * through, not a second gate — one authority, so the destination set can never
 * drift from the set the create flow offers.
 */
function assertActionDestinationsAllowed(
  authority: MailFilterAuthority,
  actions: readonly MailFilterAction[]
): void {
  for (const action of actions) {
    if (action.type === 'move-inbox') assertCanAuthorMailFilters(authority, action.inboxId)
  }
}

/**
 * Load a filter org-scoped, then authorize on the inbox it ALREADY belongs to.
 *
 * Resolve-then-authorize, the `label.ts` ordering: a foreign-org id 404s without
 * an authorization decision ever being made, so a 403 can never be used as an
 * existence oracle. `inboxId` is not patchable (the lib omits it from
 * `UpdateMailFilterInput`), so the stored inbox is always the one to judge.
 */
async function loadFilterForWrite(
  db: Parameters<typeof getMailFilterById>[0],
  authority: MailFilterAuthority,
  organizationId: string,
  filterId: string
) {
  const result = await getMailFilterById(db, organizationId, filterId)
  if (result.isErr()) throw result.error
  assertCanAuthorMailFilters(authority, result.value.inboxId)
  return result.value
}

/**
 * Per-user dismissal store for the post-connect prompt (D18).
 *
 * `access: 'user'` in the settings catalog, so one admin waving the prompt away
 * cannot hide it from the colleague who would have said yes.
 */
const RETROACTIVE_PROMPT_DISMISSED_KEY = 'mailFilters.retroactivePromptDismissed' as const

async function readDismissedPromptInboxIds(ctx: {
  session: { organizationId: string; userId: string }
}): Promise<string[]> {
  const value = await getUserSetting({
    userId: ctx.session.userId,
    organizationId: ctx.session.organizationId,
    key: RETROACTIVE_PROMPT_DISMISSED_KEY,
  })
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export const mailFiltersRouter = createTRPCRouter({
  /**
   * The caller's filters — scoped IN SQL to their authorable inboxes (§5.1).
   *
   * Never fetch-then-filter: a post-read `.filter()` still discloses counts and
   * timing for inboxes the caller cannot author on, and personal filters are
   * never listed to anyone else, ever.
   */
  list: capabilityProcedure.query(async ({ ctx }) => {
    const authority = await loadMailFilterAuthority(ctx)
    // An empty allow-list means "nothing", never "everything" — the classic
    // empty-`inArray` footgun. `listMailFilters` fails closed on it too; this
    // just saves the round trip.
    if (authority.inboxIds.length === 0) return []

    const result = await listMailFilters(ctx.db, ctx.session.organizationId, {
      inboxIds: authority.inboxIds,
    })
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The inboxes the caller may author for — the grouped list section's
   * subheadings and the create flow's inbox picker (§6.3/§6.4).
   *
   * Deliberately the SAME computation as `list`'s scope, through one function,
   * so the UI can never offer an inbox the router would then refuse (or hide one
   * it would have allowed).
   */
  authorableInboxes: capabilityProcedure.query(async ({ ctx }) => {
    const authority = await loadMailFilterAuthority(ctx)
    return authority.inboxes
  }),

  /**
   * One filter.
   *
   * A filter on an inbox the caller cannot author on reads as NOT FOUND rather
   * than forbidden — someone else's personal-inbox filter must not be
   * distinguishable from a filter that does not exist.
   */
  get: capabilityProcedure
    .input(z.object({ filterId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      const result = await getMailFilterById(ctx.db, ctx.session.organizationId, input.filterId)
      if (result.isErr()) throw result.error
      if (!authority.byId.has(result.value.inboxId)) {
        throw new NotFoundError('Filter not found')
      }
      return result.value
    }),

  /** Run history for one filter — authorship on its inbox first. */
  runs: capabilityProcedure
    .input(
      z.object({
        filterId: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      const filter = await getMailFilterById(ctx.db, ctx.session.organizationId, input.filterId)
      if (filter.isErr()) throw filter.error
      if (!authority.byId.has(filter.value.inboxId)) {
        throw new NotFoundError('Filter not found')
      }

      const result = await listMailFilterRuns(
        ctx.db,
        ctx.session.organizationId,
        input.filterId,
        input.limit
      )
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Every firing that touched one thread, newest first — the "Filtered by
   * *Newsletters*" chips on the thread header and their Undo (§6.3, D9).
   *
   * Scoped to the caller's AUTHORABLE inboxes, the same set `undoRun` judges on,
   * for two reasons: a chip that cannot be undone by the person looking at it is
   * a dead end, and the chip carries a filter NAME — naming someone else's
   * personal-mailbox filter on a thread they can see would leak exactly what
   * §5.1 keeps private. A run whose filter has since been deleted is dropped for
   * the same reason `undoRun` 404s it: the filter's inbox is a run's only
   * recorded authority.
   */
  threadRuns: capabilityProcedure
    .input(z.object({ threadId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      if (authority.inboxIds.length === 0) return []

      const runs = await listMailFilterRunsForThread(ctx.db, organizationId, input.threadId)
      if (runs.isErr()) throw runs.error
      if (runs.value.length === 0) return []

      const filters = await listMailFilters(ctx.db, organizationId, {
        inboxIds: authority.inboxIds,
      })
      if (filters.isErr()) throw filters.error
      const nameById = new Map(filters.value.map((filter) => [filter.id, filter.name]))

      return runs.value.flatMap((run) => {
        const filterName = nameById.get(run.filterId)
        if (filterName === undefined) return []
        return [{ ...run, filterName }]
      })
    }),

  create: capabilityProcedure
    .input(filterInputSchema.extend({ inboxId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      const inbox = assertCanAuthorMailFilters(authority, input.inboxId)
      assertActionsAllowed(authority, input.actions)
      assertActionDestinationsAllowed(authority, input.actions as MailFilterAction[])
      assertFilterConditionsCompile(input.conditions as ConditionGroup[], organizationId)

      /**
       * Two ceilings, chosen by the target inbox's DEFINITION (§5.2).
       *
       * Personal filters are counted per USER against a flat constant and never
       * against the org's plan allowance: pooling them would let the first
       * member to write fifty of them block everyone else in the org — a limit
       * one colleague can exhaust for the whole company is a support ticket, not
       * a control. Shared-inbox filters are org inventory and take the plan
       * limit, through the same counter the overage detector reads.
       */
      if (inbox.isPersonal) {
        const used = await countPersonalMailFilters(ctx.db, organizationId, ctx.session.userId)
        if (used >= MAX_PERSONAL_MAIL_FILTERS) {
          throw new ForbiddenError(
            `You have reached the limit of ${MAX_PERSONAL_MAIL_FILTERS} filters on your own mailbox.`
          )
        }
      } else {
        await new FeaturePermissionService(ctx.db).requireLimit(
          organizationId,
          FeatureKey.mailFiltersLimit,
          () => countBillableMailFilters(ctx.db, organizationId)
        )
      }

      const result = await createMailFilter(
        ctx.db,
        organizationId,
        {
          inboxId: input.inboxId,
          name: input.name,
          conditions: input.conditions as ConditionGroup[],
          actions: input.actions as MailFilterAction[],
          stopProcessing: input.stopProcessing,
          enabled: input.enabled,
        },
        ctx.session.userId
      )
      if (result.isErr()) throw result.error

      await onCacheEvent('mail-filter.changed', { orgId: organizationId })
      return result.value
    }),

  /**
   * Patch a filter. `inboxId` is absent from the input on purpose — it is the
   * containment boundary AND the namespace `order` is unique within, so moving a
   * filter is delete-and-recreate, which re-runs both the authorization branch
   * and the limit gate by construction.
   */
  update: capabilityProcedure
    .input(filterPatchSchema.extend({ filterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      const { filterId, actions, conditions, ...rest } = input
      await loadFilterForWrite(ctx.db, authority, organizationId, filterId)
      if (actions) {
        assertActionsAllowed(authority, actions)
        assertActionDestinationsAllowed(authority, actions as MailFilterAction[])
      }
      if (conditions !== undefined) {
        assertFilterConditionsCompile(conditions as ConditionGroup[], organizationId)
      }

      const result = await updateMailFilter(ctx.db, organizationId, filterId, {
        ...rest,
        ...(conditions !== undefined && { conditions: conditions as ConditionGroup[] }),
        ...(actions !== undefined && { actions: actions as MailFilterAction[] }),
      })
      if (result.isErr()) throw result.error

      await onCacheEvent('mail-filter.changed', { orgId: organizationId })
      return result.value
    }),

  /** Enable/disable from the list card, without opening the dialog. */
  setEnabled: capabilityProcedure
    .input(z.object({ filterId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      await loadFilterForWrite(ctx.db, authority, organizationId, input.filterId)

      const result = await setMailFilterEnabled(
        ctx.db,
        organizationId,
        input.filterId,
        input.enabled
      )
      if (result.isErr()) throw result.error

      await onCacheEvent('mail-filter.changed', { orgId: organizationId })
      return result.value
    }),

  /**
   * Rewrite ONE inbox's evaluation order. Authorized on the inbox itself rather
   * than on each filter: `order` is per-inbox and the list must be complete, so
   * the inbox is the unit of the operation. Lib re-checks that every supplied id
   * belongs to this org and this inbox.
   */
  reorder: capabilityProcedure
    .input(
      z.object({
        inboxId: z.string().min(1),
        orderedFilterIds: z.array(z.string().min(1)),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      assertCanAuthorMailFilters(authority, input.inboxId)

      const result = await reorderMailFilters(
        ctx.db,
        organizationId,
        input.inboxId,
        input.orderedFilterIds
      )
      if (result.isErr()) throw result.error

      await onCacheEvent('mail-filter.changed', { orgId: organizationId })
    }),

  delete: capabilityProcedure
    .input(z.object({ filterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      await loadFilterForWrite(ctx.db, authority, organizationId, input.filterId)

      const result = await deleteMailFilter(ctx.db, organizationId, input.filterId)
      if (result.isErr()) throw result.error

      await onCacheEvent('mail-filter.changed', { orgId: organizationId })
    }),

  /**
   * How many EXISTING conversations these conditions match — the dialog footer
   * (§6.5). Debounced and cancelled client-side; bounded server-side.
   *
   * ⚠️ **A lower bound, not a promise.** This evaluates under the REQUESTING
   * USER's viewer (a preview must not count threads the author cannot see) while
   * the engine fires as SYSTEM. For a shared inbox the author holds `edit` on
   * the two agree; they can still diverge on record-derived grants, so the real
   * firing can only ever reach MORE threads than this. `lowerBound` rides on the
   * response so the copy can say "at least".
   *
   * Same predicate builder as the fire path (invariant 5) — there is no preview
   * evaluator.
   */
  previewMatchCount: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1), conditions: conditionsSchema }))
    .query(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      assertCanAuthorMailFilters(authority, input.inboxId)

      const viewer = await getCachedUserInstanceGrants(ctx.session.userId, organizationId)
      return previewMatchCount(
        ctx.db,
        organizationId,
        input.inboxId,
        input.conditions as ConditionGroup[],
        viewer
      )
    }),

  /**
   * Apply one filter to the conversations already in its inbox (§7).
   *
   * Enqueues the paged backfill — it never mutates inline. Every thread it
   * touches gets its own `MailFilterRun` at `source: 'retroactive'`, so the same
   * audit trail and the same Undo apply, and the claim key
   * `(filterId, messageId, source)` keeps a backfill distinct from the live
   * firing on the same message.
   */
  applyRetroactively: capabilityProcedure
    .input(z.object({ filterId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)
      const filter = await loadFilterForWrite(ctx.db, authority, organizationId, input.filterId)

      const backfillable = await loadBackfillableFilter(ctx.db, organizationId, filter.id)
      if (backfillable.isErr()) throw backfillable.error

      await applyRetroactively({
        organizationId,
        filterId: filter.id,
        requestedByUserId: ctx.session.userId,
      })
      return { enqueued: true as const, inboxId: filter.inboxId }
    }),

  /**
   * Reverse one firing — the thread badge's Undo and the run history's (§6.3).
   *
   * Authorized on the filter's own inbox, through the same helper every mutation
   * uses. A run whose filter has since been deleted reads as NOT FOUND: the
   * filter's inbox is the only recorded authority for a run, and guessing one
   * from the thread's current inbox would let a `move-inbox` firing decide who
   * may reverse it.
   */
  undoRun: capabilityProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const authority = await loadMailFilterAuthority(ctx)

      const run = await getMailFilterRunById(ctx.db, organizationId, input.runId)
      if (run.isErr()) throw run.error
      const filter = await getMailFilterById(ctx.db, organizationId, run.value.filterId)
      if (filter.isErr()) throw new NotFoundError('Filter run not found')
      if (!authority.byId.has(filter.value.inboxId)) {
        throw new NotFoundError('Filter run not found')
      }

      const result = await undoMailFilterRun(ctx.db, organizationId, input.runId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * "Apply your N filters to M existing conversations?" — the post-connect
   * prompt (D18 / §7), or `null` when there is nothing to ask.
   *
   * A freshly connected mailbox backfills with filters OFF, because
   * `message:received` is only published for `!ctx.isInitialSync`. That is the
   * safe default; this is how the owner finds out. The prompt is a QUESTION —
   * answering it goes through `applyRetroactively` above, which is paged, logged
   * and undoable. Nothing here mutates anything.
   *
   * Scoped to the caller's authorable inboxes, so it can never surface someone
   * else's personal mailbox.
   */
  pendingRetroactivePrompt: capabilityProcedure.query(async ({ ctx }) => {
    const organizationId = ctx.session.organizationId
    const authority = await loadMailFilterAuthority(ctx)
    if (authority.inboxIds.length === 0) return null

    const dismissed = await readDismissedPromptInboxIds(ctx)
    const candidates = authority.inboxIds.filter((id) => !dismissed.includes(id))
    if (candidates.length === 0) return null

    const prompt = await findPendingRetroactivePrompt(ctx.db, organizationId, candidates)
    if (!prompt) return null

    return { ...prompt, inboxName: authority.byId.get(prompt.inboxId)?.name ?? '' }
  }),

  /** Wave the post-connect prompt away for one inbox, for this member only. */
  dismissRetroactivePrompt: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanAuthorMailFilters(authority, input.inboxId)

      const dismissed = await readDismissedPromptInboxIds(ctx)
      if (dismissed.includes(input.inboxId)) return
      await updateUserSetting({
        userId: ctx.session.userId,
        organizationId: ctx.session.organizationId,
        key: RETROACTIVE_PROMPT_DISMISSED_KEY,
        value: [...dismissed, input.inboxId],
      })
    }),
})
