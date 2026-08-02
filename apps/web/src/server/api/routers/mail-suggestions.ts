// apps/web/src/server/api/routers/mail-suggestions.ts

import { getCachedUserInstanceGrants, getOrgCache } from '@auxx/lib/cache'
import { addExcludedSender, requireChannelManageAccess } from '@auxx/lib/channels'
import { ForbiddenError, NotFoundError } from '@auxx/lib/errors'
import type { Inbox } from '@auxx/lib/inboxes'
import { previewMatchCount } from '@auxx/lib/mail-filters'
import {
  describeSubjectKey,
  dismissMailSuggestion,
  getMailSuggestionById,
  listMailSuggestions,
  type MailSuggestionKind,
  type MailSuggestionRow,
  markMailSuggestionAccepted,
} from '@auxx/lib/mail-suggestions'
import {
  assertCanUnsubscribe,
  canUnsubscribeOnInbox,
  executeUnsubscribe,
  isSharedInbox,
  resolveUnsubscribeTarget,
} from '@auxx/lib/mail-unsubscribe'
import { z } from 'zod'
import {
  assertCanAuthorMailFilters,
  loadMailFilterAuthority,
} from '~/server/lib/mail-filter-authoring-access'
import { capabilityProcedure, createTRPCRouter } from '../trpc'
import { mailFiltersRouter } from './mail-filters'

/**
 * tRPC surface for mined mail suggestions + unsubscribe
 * (plans/mail-filter/03-suggestions-plan.md §7, §8).
 *
 * `@auxx/lib/mail-suggestions` and `@auxx/lib/mail-unsubscribe` hold ZERO
 * permission checks by house rule, so **this router is the only authorization
 * path** for the whole feature. `mail-suggestions.test.ts` pins it.
 *
 * Three separate authorities meet here and must not be conflated:
 *
 * | Operation | Gate |
 * | --- | --- |
 * | listing cards | {@link loadMailSuggestionScope}, in SQL — personal ⇒ owner only |
 * | dismissing | inbox write — it silences that sender for everyone, permanently |
 * | unsubscribing | `assertCanUnsubscribe` — inbox write, NO automation key (§7.1) |
 * | accepting (⇒ a filter) | `assertCanAuthorMailFilters` — the ordinary filter gate |
 *
 * **The suggestion is a PREFILL, never an authorization path** (invariant 10).
 * `accept` therefore does not write a filter itself: it calls the ordinary
 * `mailFilters.create` procedure through a server-side caller, so the authorship
 * branch, the keyed-action rule, the `move-inbox` destination check,
 * `assertFilterConditionsCompile` and both plan limits all run exactly as they do
 * when a filter is authored by hand. A second create path here is the bug that
 * invariant would be describing.
 */

/** The caller's visible inboxes, resolved once per request. */
interface MailSuggestionScope {
  /** The SQL scope for `listMailSuggestions` — never a post-read filter. */
  inboxIds: string[]
  byId: Map<string, Inbox>
}

/**
 * Which inboxes' cards this member may see (§7.2).
 *
 * Deliberately `canUnsubscribeOnInbox`, the §7.1 predicate, rather than a
 * reading lens or a new rule:
 *
 * - **Personal-inbox cards are visible to their OWNER only**, and `isMailAdmin`
 *   confers no override — that predicate branches on the inbox DEFINITION, so
 *   personal-ness cannot be forged, only self-declared into a stricter rule.
 * - The filter-authoring set is a strict SUBSET of this one (authoring wants
 *   `automationRules.manage` *and* inbox write; unsubscribing wants inbox write
 *   alone), so scoping visibility here can never hide a card its viewer could
 *   have accepted — while a mere reader, who could act on nothing, is not shown
 *   an action prompt they cannot answer.
 *
 * One computation, two consumers (`list` and `count`), so the badge and the cards
 * cannot drift. The mutations re-derive authority per operation against the row
 * they are about — see {@link loadSuggestionForWrite}.
 */
async function loadMailSuggestionScope(ctx: {
  session: { organizationId: string; userId: string }
  capabilities: { canEditInstance(key: 'inbox', instanceId: string): boolean }
}): Promise<MailSuggestionScope> {
  const inboxes = await getOrgCache().get(ctx.session.organizationId, 'inboxes')
  const visible = inboxes.filter((inbox) =>
    canUnsubscribeOnInbox(inbox, ctx.session.userId, ctx.capabilities)
  )

  return {
    inboxIds: visible.map((inbox) => inbox.id),
    byId: new Map(visible.map((inbox) => [inbox.id, inbox])),
  }
}

/** Personal-ness, the way every mail gate reads it: definition first, marker second. */
function isPersonalInbox(inbox: Inbox): boolean {
  return inbox.entityDefinitionKey === 'personal_inbox' || inbox.isPersonal
}

/**
 * Load one suggestion and its inbox for a WRITE, resolve-then-authorize.
 *
 * Deliberately resolved against the whole org's inboxes rather than against
 * {@link loadMailSuggestionScope}'s set, so each mutation's own gate is the thing
 * that refuses and a caller who may read a shared mailbox but not write it gets a
 * truthful 403 instead of a 404 that blames the row.
 *
 * The one case that stays a 404 is the one §7.2 is actually about: **somebody
 * else's personal mailbox**. A 403 there would confirm the card exists, and a
 * private mailbox's contents must not be distinguishable from an id that was
 * never real.
 */
async function loadSuggestionForWrite(
  db: Parameters<typeof getMailSuggestionById>[0],
  ctx: { session: { organizationId: string; userId: string } },
  suggestionId: string
): Promise<{ suggestion: MailSuggestionRow; inbox: Inbox }> {
  const organizationId = ctx.session.organizationId
  const result = await getMailSuggestionById(db, organizationId, suggestionId)
  if (result.isErr()) throw result.error

  const inboxes = await getOrgCache().get(organizationId, 'inboxes')
  const inbox = inboxes.find((row) => row.id === result.value.inboxId)
  if (!inbox) throw new NotFoundError('Suggestion not found')
  if (isPersonalInbox(inbox) && inbox.ownerUserId !== ctx.session.userId) {
    throw new NotFoundError('Suggestion not found')
  }

  return { suggestion: result.value, inbox }
}

/** The name the accepted filter is created under. */
function filterNameFor(kind: MailSuggestionKind, subjectKey: string): string {
  const subject = describeSubjectKey(subjectKey)
  const name =
    kind === 'auto-tag'
      ? `Tag mail from ${subject}`
      : kind === 'auto-assign'
        ? `Assign mail from ${subject}`
        : `Archive mail from ${subject}`
  return name.slice(0, 200)
}

/** Request IP/UA for the shared-inbox audit row (§6.4, invariant 11). */
function auditContextFrom(headers: Headers | undefined) {
  return {
    ipAddress: headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headers?.get('user-agent') ?? null,
  }
}

export const mailSuggestionsRouter = createTRPCRouter({
  /**
   * The caller's undecided cards — scoped IN SQL to their visible inboxes.
   *
   * Never fetch-then-filter: a post-read `.filter()` still discloses counts and
   * timing for mailboxes the caller cannot see, and a personal mailbox's cards
   * are never listed to anyone but its owner.
   *
   * Everything the card renders comes off the row's denormalized `evidence`, so
   * display costs no further query (§4) — only `inboxName` and the two authority
   * booleans are added here, and both are already resolved for the scope.
   */
  list: capabilityProcedure.query(async ({ ctx }) => {
    const scope = await loadMailSuggestionScope(ctx)
    // An empty allow-list means "nothing", never "everything" — the classic
    // empty-`inArray` footgun. `listMailSuggestions` fails closed on it too.
    if (scope.inboxIds.length === 0) return []

    const authority = await loadMailFilterAuthority(ctx)
    const result = await listMailSuggestions(ctx.db, ctx.session.organizationId, {
      inboxIds: scope.inboxIds,
      userId: ctx.session.userId,
    })
    if (result.isErr()) throw result.error

    return result.value.flatMap((row) => {
      const inbox = scope.byId.get(row.inboxId)
      if (!inbox) return []
      return [
        {
          id: row.id,
          inboxId: row.inboxId,
          inboxName: inbox.name,
          isSharedInbox: isSharedInbox(inbox),
          kind: row.kind,
          subjectKey: row.subjectKey,
          evidence: row.evidence,
          createdAt: row.createdAt,
          /** Whether `accept` would succeed — the card hides what we would refuse. */
          canAuthorFilter: authority.byId.has(row.inboxId),
          /**
           * The miner only ever mints `kind: 'unsubscribe'` for a group that
           * PASSED the §6.2 safety gate, so this is authority alone. A group we
           * would refuse arrives as `auto-archive` and the card renders the
           * block/filter-to-spam alternative instead.
           */
          canUnsubscribe: row.kind === 'unsubscribe',
        },
      ]
    })
  }),

  /**
   * How many cards the caller could act on — the mail-toolbar badge and the
   * bell's share of `useApprovalsCount`.
   *
   * Deliberately the same scope and the same `status: 'new'` default as `list`:
   * a badge that counts a different set than the surface renders is a bug, not a
   * tuning knob.
   */
  count: capabilityProcedure.query(async ({ ctx }) => {
    const scope = await loadMailSuggestionScope(ctx)
    if (scope.inboxIds.length === 0) return { count: 0 }

    const result = await listMailSuggestions(ctx.db, ctx.session.organizationId, {
      inboxIds: scope.inboxIds,
      userId: ctx.session.userId,
    })
    if (result.isErr()) throw result.error
    return { count: result.value.length }
  }),

  /**
   * "No thanks" — permanently, for that `subjectKey`.
   *
   * ⚠️ **A status write, never a delete** (invariant 7). Dismissed rows ARE the
   * suppression list `listSuppressedSubjectKeys` reads, so deleting one would
   * resurrect the same card on the next weekly sweep, forever.
   */
  dismiss: capabilityProcedure
    .input(z.object({ suggestionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const { inbox } = await loadSuggestionForWrite(ctx.db, ctx, input.suggestionId)
      /**
       * The same inbox-write authority unsubscribing needs, because dismissal is
       * an org-level decision on a shared mailbox: it silences that sender's card
       * permanently, for everyone, and the next weekly sweep honours it.
       */
      if (!canUnsubscribeOnInbox(inbox, ctx.session.userId, ctx.capabilities)) {
        throw new ForbiddenError("You don't have permission to change this mailbox's suggestions.")
      }

      const result = await dismissMailSuggestion(ctx.db, organizationId, input.suggestionId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Accept — one click, through the ORDINARY filter-create mutation (§8.4, S10).
   *
   * The suggestion supplies the conditions and actions the miner already
   * validated against `assertFilterConditionsCompile` when it wrote the row; the
   * gate that decides whether they may be saved is the one every hand-authored
   * filter goes through, reached here by calling `mailFilters.create` rather than
   * by re-implementing it (invariant 10).
   *
   * `matchCount` rides on the response so the caller can ask the follow-up
   * *"also apply to N existing conversations?"* as a confirm rather than opening
   * the full filter dialog. It is a LOWER BOUND — it evaluates under the
   * requesting user's viewer while the engine fires as SYSTEM.
   */
  accept: capabilityProcedure
    .input(z.object({ suggestionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const { suggestion } = await loadSuggestionForWrite(ctx.db, ctx, input.suggestionId)

      /**
       * Asserted here as well as inside the create call, so the refusal happens
       * before anything else runs — and so a future change to how the filter is
       * created can never quietly drop the gate.
       */
      const authority = await loadMailFilterAuthority(ctx)
      assertCanAuthorMailFilters(authority, suggestion.inboxId)

      const filter = await mailFiltersRouter.createCaller(ctx as never).create({
        inboxId: suggestion.inboxId,
        name: filterNameFor(suggestion.kind, suggestion.subjectKey),
        conditions: suggestion.proposedConditions,
        actions: suggestion.proposedActions,
        stopProcessing: false,
        enabled: true,
      })

      const accepted = await markMailSuggestionAccepted(
        ctx.db,
        organizationId,
        suggestion.id,
        filter.id
      )
      if (accepted.isErr()) throw accepted.error

      const viewer = await getCachedUserInstanceGrants(ctx.session.userId, organizationId)
      const preview = await previewMatchCount(
        ctx.db,
        organizationId,
        suggestion.inboxId,
        suggestion.proposedConditions,
        viewer
      )

      return {
        filterId: filter.id,
        inboxId: suggestion.inboxId,
        matchCount: preview.count,
        matchCountCapped: preview.capped,
      }
    }),

  /**
   * Unsubscribe this inbox from the card's list (§6).
   *
   * ⚠️ Gated on **inbox write alone** — `assertCanUnsubscribe`, and deliberately
   * NOT `automationRules.manage` (§7.1). Unsubscribing is a mail operation, not
   * an automation one; requiring an automation grant to stop a newsletter would
   * gate mail on admin rank, which the mail guide forbids.
   *
   * `refused` comes back as an OUTCOME, not an error: "we won't unsubscribe from
   * this, block the sender instead" is a legitimate answer the card renders.
   * `openUrl` is set for the `http` tier only — we hand that URL to the client to
   * open, and never fetch it ourselves.
   */
  unsubscribe: capabilityProcedure
    .input(z.object({ suggestionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const { suggestion, inbox } = await loadSuggestionForWrite(ctx.db, ctx, input.suggestionId)

      assertCanUnsubscribe(inbox, ctx.session.userId, ctx.capabilities)

      const result = await executeUnsubscribe(ctx.db, {
        organizationId,
        inboxId: suggestion.inboxId,
        subjectKey: suggestion.subjectKey,
        userId: ctx.session.userId,
        // Never derived in lib — a shared-inbox unsubscribe stops the mail for
        // colleagues who never saw the dialog, and that is what writes the audit
        // row (invariant 11).
        isSharedInbox: isSharedInbox(inbox),
        auditContext: auditContextFrom(ctx.headers),
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Block this group's sender on the channel — the answer offered when we REFUSE
   * to unsubscribe (§6.2): an unverified sender with no list identity gets
   * prevention, not a polite request.
   *
   * ⚠️ **This is a THIRD authority, stricter than the other two.** Unsubscribe and
   * dismiss are gated on inbox write; blocking writes `ChannelSettings.excludeSenders`
   * on the *channel*, one step EARLIER than a filter — `shouldIgnoreMessage` runs
   * before the write, so blocked mail never becomes a thread at all
   * (mail-filters §3.5). It affects every inbox fed by that channel, not just this
   * one, so it takes `requireChannelManageAccess` — per-channel authority, never
   * the coarse `channelsManage` key. `addExcludedSender` performs NO check of its
   * own.
   *
   * ⚠️ **Blocks the specific from-ADDRESS, never the group's domain key.** The
   * refusal branch is dominated by consumer mail — on real data the refused groups
   * include `domain:gmail.com` (477 messages), `hotmail.com`, `outlook.com`,
   * `yahoo.com`. Blocking a domain key there would stop every consumer sender on
   * the channel, customers included. Widening to a domain is a deliberate act that
   * belongs in channel settings, not one click on a suggestion card.
   */
  blockSender: capabilityProcedure
    .input(z.object({ suggestionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const organizationId = ctx.session.organizationId
      const { suggestion, inbox } = await loadSuggestionForWrite(ctx.db, ctx, input.suggestionId)

      // Inbox write first: without it you may not act on this mail at all.
      assertCanUnsubscribe(inbox, ctx.session.userId, ctx.capabilities)

      const targetResult = await resolveUnsubscribeTarget(
        ctx.db,
        organizationId,
        suggestion.inboxId,
        suggestion.subjectKey
      )
      if (targetResult.isErr()) throw targetResult.error
      const target = targetResult.value

      const address = target.senderIdentifier?.trim()
      if (!address) {
        throw new NotFoundError('No sender address to block for this suggestion')
      }

      // Channel authority — the settings row we are about to write is shared by
      // every inbox this channel feeds.
      const channelCtx = { db: ctx.db, organizationId, userId: ctx.session.userId }
      await requireChannelManageAccess(channelCtx, target.integrationId)

      // Idempotent, and `updateSettings` runs `retroactivelyIgnoreThreads`, so mail
      // already in the inbox is marked IGNORED rather than left behind.
      const blocked = await addExcludedSender(channelCtx, target.integrationId, address)
      if (!blocked.ok) throw blocked.error

      // The card has been answered — blocking IS the decision, so it must not come
      // back next sweep. A status write, never a delete (invariant 7).
      const dismissed = await dismissMailSuggestion(ctx.db, organizationId, suggestion.id)
      if (dismissed.isErr()) throw dismissed.error

      return { blockedAddress: address, integrationId: target.integrationId }
    }),
})
