// apps/web/src/server/api/routers/mail-classification.ts

import { getCredentials, ProviderRegistry, QuotaService, SystemModelService } from '@auxx/lib/ai'
// The `@auxx/lib/ai` barrel re-exports `ModelType` as a TYPE, so the enum VALUE
// has to come from its own module — the same deep import `aiIntegration.ts` makes.
import { ModelType } from '@auxx/lib/ai/providers/types'
import { CREDIT_USD_VALUE } from '@auxx/lib/ai/quota/client'
import { onCacheEvent } from '@auxx/lib/cache'
import { BadRequestError, ConflictError } from '@auxx/lib/errors'
import {
  cancelMailReclassifySample,
  countReclassifiableThreads,
  enqueueMailReclassifySample,
  getMailReclassifySampleStatus,
} from '@auxx/lib/mail-classification'
import {
  MAIL_CLASSIFY_BODY_CHARS,
  MAIL_RECLASSIFY_BACKLOG_COUNT_CAP,
  MAIL_RECLASSIFY_MAX_THREADS,
  MAIL_RECLASSIFY_SAMPLE_SIZE,
} from '@auxx/lib/mail-classification/client'
import { getEligibleClassificationTags } from '@auxx/lib/mail-classification/labels'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'
import { TagService } from '@auxx/lib/tags'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import {
  assertCanConfigureInboxAutomation,
  loadMailFilterAuthority,
} from '~/server/lib/mail-filter-authoring-access'
import { capabilityProcedure, createTRPCRouter } from '../trpc'

/**
 * tRPC surface for the mail-classification opt-in
 * (`plans/mail-filter/05-mail-classification-plan.md` §5, §6.4).
 *
 * The classifier reads an inbound message and applies an EXISTING tag. Two
 * things arm it, and both are opt-in (C8, "double guard, or zero model calls"):
 * a tag marked `tag_ai_classify`, and an inbox listed in the
 * `mailClassificationInboxIds` org setting. This router owns the second half.
 *
 * ## Why this is a router of its own rather than `settings.updateOrganizationSetting`
 *
 * The generic org-settings door is gated on `settings.manage` — a coarse admin
 * key. Writing this list through it would let an admin opt in a colleague's
 * PERSONAL mailbox, which §5 forbids outright ("a personal mailbox must never
 * be opted in by an admin"), and which per-inbox storage exists to make
 * inexpressible. `setting.ts` refuses the key for exactly that reason; the gate
 * lives here instead:
 *
 * ```
 *   personal inbox owned by the caller  →  allowed. NO permission key.
 *   shared inbox                        →  automationRules.manage AND inbox admin
 * ```
 *
 * That is `~/server/lib/mail-filter-authoring-access` verbatim — §5 says the
 * opt-in uses "the same gate that governs authoring a mail filter on that
 * inbox", so it reuses that authority rather than restating it. Never admin
 * rank (invariant 11; `docs/channels-mail-architecture-guide.md`).
 *
 * `capabilityProcedure`, never `permissionProcedure(automationRulesManage)`:
 * the key is one BRANCH of the rule, and the archetypal user — a member
 * classifying their own personal mailbox — holds no automation grant.
 *
 * There is deliberately **no bulk-enable procedure**. One inbox per call, each
 * authorized on its own, is what keeps "classify everything" unexpressible.
 */

/**
 * The org-settings key holding the opted-in inbox ids (`string[]`).
 *
 * Declared in `packages/lib/src/settings/catalog.ts`; spelled once here so the
 * two reads below and the `setting.ts` refusal cannot drift apart.
 */
export const MAIL_CLASSIFICATION_INBOXES_KEY = 'mailClassificationInboxIds' as const

/** The stored value, defensively — a jsonb blob is only as typed as its reader. */
function toInboxIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string')
}

async function readOptedInInboxIds(organizationId: string): Promise<string[]> {
  const value = await getOrganizationSetting({
    organizationId,
    key: MAIL_CLASSIFICATION_INBOXES_KEY,
  })
  return toInboxIds(value)
}

/**
 * How many tags the classifier could actually choose from, org-wide.
 *
 * `thread`-scoped only (Q3): `article` tags exist for KB content and offering
 * them to a mail classifier is a category error — `labels.ts` filters the same
 * way, so this count is the one the prompt would really see. Zero here means
 * the opt-in is inert (C8), which is why §6.4 has the UI disable the switch and
 * say so rather than let it look like it worked.
 */
async function countEligibleTags(
  organizationId: string,
  userId: string,
  db: ConstructorParameters<typeof TagService>[2]
): Promise<number> {
  const tags = await new TagService(organizationId, userId, db).getAllTags({ scope: 'thread' })
  return tags.filter((tag) => tag.aiClassify).length
}

// ─────────────────────────────────────────────────────────────────────────────
// Retroactive re-classification (plans/mail-filter/07-mail-reclassification-plan.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scope a run is pointed at, as JSON (07 §2.4, axis 1).
 *
 * Mirrors `MailReclassifyRange` — presets rather than free-form, so the count
 * preview stays cheap. `days`/`threads` are bounded here as well as in
 * `resolveReclassifyWindow` because this is the untrusted edge; the lib call
 * clamps again, which is the point of it being the one place presets become
 * bounds.
 */
const reclassifyRangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('days'), days: z.number().int().positive().max(3650) }),
  z.object({
    kind: z.literal('threads'),
    threads: z.number().int().positive().max(MAIL_RECLASSIFY_MAX_THREADS),
  }),
  z.object({
    kind: z.literal('custom'),
    sinceIso: z.string().min(1),
    untilIso: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal('all-time') }),
])

const reclassifyModeSchema = z.enum(['fill-gaps', 're-classify'])

const reclassifyScopeInput = z.object({
  inboxId: z.string().min(1),
  range: reclassifyRangeSchema,
  mode: reclassifyModeSchema,
})

/**
 * USD to credits, ROUNDED UP.
 *
 * ⚠️ Deliberately not `usdToCredits`, which rounds to nearest: that lets a small
 * run quote 0 credits while still costing something, and "0" reads as free. Every
 * rounding decision in this estimate leans high, because the failure that matters
 * is a confirm the bill then exceeds.
 */
function ceilCredits(usd: number): number {
  return Math.ceil(usd / CREDIT_USD_VALUE)
}

/**
 * Chars per token, used DELIBERATELY LOW so the token count comes out high.
 *
 * English averages ~4 chars/token; mail carries markup, URLs and quoted headers
 * that tokenize worse, so 3 is the conservative floor. Every rounding decision in
 * this estimate leans the same way: a confirm that under-states the bill is the
 * one that damages trust.
 */
const CHARS_PER_TOKEN = 3

/**
 * Fixed prompt overhead per call, in tokens: the system prompt, the response
 * schema, the `From:`/`Subject:` lines and the JSON scaffolding around the label
 * list. Rounded up generously.
 */
const CLASSIFY_FIXED_OVERHEAD_TOKENS = 250

/** Output is a tag id plus a confidence number. Small and bounded; rounded up. */
const CLASSIFY_ESTIMATED_OUTPUT_TOKENS = 50

/**
 * What one classification of one thread costs, and whether the org actually pays
 * for it.
 *
 * ⚠️ **`credits: 0` for BYO, and this is the bug it was written to fix.** Credits
 * are only drawn when the credentials are `SYSTEM` — `LLMOrchestrator`'s quota
 * gate skips the deduction entirely for `CUSTOM` ones. Pricing the run against
 * the model's list price regardless meant an org on its own API key was quoted
 * several hundred credits for something that would charge it nothing, which
 * discourages a free action.
 *
 * ⚠️ **The label list is counted, not assumed.** The prompt embeds every eligible
 * tag's title AND description (plan 05 C3), so the per-call cost grows as an org
 * adds categories. A fixed token guess drifts low exactly as the label set grows,
 * which is the direction that matters.
 *
 * Null means "we cannot say" (no default model, or no registry price) and the UI
 * renders "metered per thread" rather than inventing a number.
 * `UNPRICED_FALLBACK_CREDITS` is deliberately NOT used: it exists for BILLING a
 * call that slipped through unpriced, and charging that rate in a preview would
 * over-state by orders of magnitude.
 */
async function estimatePerThread(
  db: ConstructorParameters<typeof SystemModelService>[0],
  organizationId: string,
  userId: string
): Promise<{ usd: number; billed: boolean } | null> {
  const def = await new SystemModelService(db, organizationId).getDefault(ModelType.LLM)
  if (!def) return null

  // Same lookup the orchestrator's quota gate makes, off the `aiCredentials` org
  // cache, so "will this be billed" is answered by the same source that decides it.
  const credentials = await getCredentials(
    { db, organizationId, userId },
    def.provider,
    def.model,
    ModelType.LLM
  ).catch(() => null)
  const billed = (credentials?.providerType ?? 'CUSTOM') === 'SYSTEM'
  if (!billed) return { usd: 0, billed: false }

  const price = ProviderRegistry.getModelCapabilities(def.model)?.costPer1kTokens
  if (!price) return null

  // The real label list, not a guess at its size.
  const labels = await getEligibleClassificationTags(db, organizationId).catch(() => [])
  const labelChars = labels.reduce(
    (total, label) => total + label.title.length + (label.description?.length ?? 0) + 40,
    0
  )

  const inputTokens =
    CLASSIFY_FIXED_OVERHEAD_TOKENS +
    Math.ceil(MAIL_CLASSIFY_BODY_CHARS / CHARS_PER_TOKEN) +
    Math.ceil(labelChars / CHARS_PER_TOKEN)

  return {
    usd: (inputTokens * price.input + CLASSIFY_ESTIMATED_OUTPUT_TOKENS * price.output) / 1000,
    billed: true,
  }
}

/**
 * Is a channel routed to this inbox mid-backfill (07 R-Q8)?
 *
 * A run started during a sync races the backfill and misses everything still
 * arriving — the user pays for a partial answer and has no way to tell. The
 * post-sync prompt (07 §3.4) exists so they are asked at the right moment
 * instead.
 *
 * ⚠️ Deliberately a live read, not the `channels` org cache: that cache
 * explicitly omits `syncStatus` because it flips too often to be cached, so
 * reading it there would answer "not syncing" for the whole cache TTL.
 *
 * `deletedAt IS NULL` because disconnect is a soft delete
 * (`docs/channels-mail-architecture-guide.md`) — a disconnected channel frozen
 * in `SYNCING` would otherwise block the inbox forever.
 */
async function isChannelSyncInProgress(
  db: { execute: (query: ReturnType<typeof sql>) => Promise<{ rows?: unknown[] }> },
  organizationId: string,
  inboxId: string
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM "InboxIntegration" ii
    JOIN "Integration" i ON i."id" = ii."integrationId"
    WHERE ii."inboxId" = ${inboxId}
      AND i."organizationId" = ${organizationId}
      AND i."deletedAt" IS NULL
      AND i."syncStatus" = 'SYNCING'
    LIMIT 1
  `)
  return (result.rows?.length ?? 0) > 0
}

export const mailClassificationRouter = createTRPCRouter({
  /**
   * The card's whole state: is this inbox opted in, is there anything for the
   * classifier to apply, and can it currently pay for a call.
   *
   * Authorized exactly like the write. A read is a disclosure too — answering
   * "not opted in" for a colleague's personal mailbox would confirm it exists.
   */
  getInboxSettings: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      const [inboxIds, eligibleTagCount, quota] = await Promise.all([
        readOptedInInboxIds(ctx.session.organizationId),
        countEligibleTags(ctx.session.organizationId, ctx.session.userId, ctx.db),
        // LIVE state, deliberately not a record of the last failure. The
        // classifier runs in the background with no user watching, so an
        // exhausted balance stops it in silence — every other AI surface finds
        // out because a human was mid-action and got a dialog. This card is the
        // only place that silence can be broken, and reading the current status
        // means it cannot go stale or need clearing.
        new QuotaService(ctx.db, ctx.session.organizationId).getQuotaStatus(),
      ])

      return {
        enabled: inboxIds.includes(input.inboxId),
        eligibleTagCount,
        // Only meaningful for orgs on system credentials — BYO calls never draw
        // credits, so their balance stays untouched and `isExceeded` stays
        // false. An org that burned its credits and THEN moved to its own key
        // is the one case this over-reports, and the sentence it produces is
        // still true, just no longer the reason anything stopped.
        creditsExhausted: quota?.isExceeded ?? false,
      }
    }),

  /**
   * Opt one inbox in or out.
   *
   * Read-modify-write on a jsonb list: last writer wins on a simultaneous
   * toggle of two DIFFERENT inboxes, which is the honest trade for not adding a
   * table. The window is one request and the loser is re-toggleable, so it is
   * not worth a lock.
   *
   * Enabling with zero eligible tags is ALLOWED, not refused. The double guard
   * (C8) already makes such an inbox inert — no model call, no bill — and
   * refusing would make the order of operations load-bearing ("mark a tag
   * before you may arm the inbox"). The UI states the inertness instead.
   */
  setInboxEnabled: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      const current = await readOptedInInboxIds(ctx.session.organizationId)
      const next = input.enabled
        ? Array.from(new Set([...current, input.inboxId]))
        : current.filter((id) => id !== input.inboxId)

      // A no-op write would still bust the org cache for everyone.
      if (next.length !== current.length) {
        await updateOrganizationSetting({
          organizationId: ctx.session.organizationId,
          key: MAIL_CLASSIFICATION_INBOXES_KEY,
          value: next,
          db: ctx.db,
        })
        // The guard reads this through the `orgSettings` org cache (§3.1 exit 3),
        // so without this the classifier keeps answering with the old list.
        await onCacheEvent('org.settings.changed', {
          orgId: ctx.session.organizationId,
          broadcastUserKeys: true,
        })

        // Routing this key out of `settings.updateOrganizationSetting` would
        // otherwise have dropped it out of the audit trail — and "AI started
        // reading this mailbox" is the last change that should be untraceable.
        await recordAuditFromCtx(ctx, {
          category: 'settings',
          action: 'setting.changed',
          targetType: 'OrganizationSetting',
          targetId: MAIL_CLASSIFICATION_INBOXES_KEY,
          newState: { value: next },
          metadata: { inboxId: input.inboxId, enabled: input.enabled },
        })
      }

      return { enabled: input.enabled }
    }),

  /**
   * The backlog row's number (07 §3.1) — how much of this inbox's history the
   * classifier has never seen.
   *
   * ⚠️ Always ALL TIME + `fill-gaps`, regardless of what the dialog is currently
   * set to. The row answers "is there history worth classifying at all", which is
   * a different question from the dialog's 30-day default, and a row keyed on the
   * dialog's scope would vanish the moment someone narrowed the range.
   *
   * Capped at {@link MAIL_RECLASSIFY_BACKLOG_COUNT_CAP} and reported as such (07
   * R-Q5): an order of magnitude for a decision, not a billing figure, and an
   * exact count over a large mailbox is a slow query.
   *
   * A precondition failure (not opted in, no eligible tags) answers **zero**
   * rather than throwing. Both mean "there is nothing to offer here", and the
   * card already says why — turning a settings page into an error because a
   * background query disagreed with the toggle it is rendered next to would be
   * noise. The dialog, where a human is mid-action, throws instead.
   */
  getBacklog: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      const counted = await countReclassifiableThreads(ctx.db, {
        organizationId: ctx.session.organizationId,
        inboxId: input.inboxId,
        range: { kind: 'all-time' },
        mode: 'fill-gaps',
        cap: MAIL_RECLASSIFY_BACKLOG_COUNT_CAP,
      })
      if (counted.isErr()) {
        return { count: 0, capped: false, cap: MAIL_RECLASSIFY_BACKLOG_COUNT_CAP }
      }
      return {
        count: counted.value.count,
        capped: counted.value.capped,
        cap: counted.value.cap,
      }
    }),

  /**
   * What one run over this scope would touch, and roughly what it would cost
   * (07 §3.2).
   *
   * ⚠️ The count comes from `countReclassifiableThreads`, which compiles the SAME
   * `buildReclassifyWhere` predicate the run pages over (07 invariant 10). The
   * number in the confirm is the number the user agreed to spend on, so a second
   * implementation here would be a way to quietly charge for something else.
   *
   * Authorized exactly like the opt-in: `assertCanConfigureInboxAutomation`, never
   * admin rank. A bulk run bills the org and reads colleagues' mail, so it gets no
   * looser a gate than arming the inbox in the first place (07 §2.4, axis 3).
   */
  getReclassifyPreview: capabilityProcedure
    .input(reclassifyScopeInput)
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      const [counted, perThread, syncInProgress] = await Promise.all([
        countReclassifiableThreads(ctx.db, {
          organizationId: ctx.session.organizationId,
          inboxId: input.inboxId,
          range: input.range,
          mode: input.mode,
        }),
        // A missing default model must not blank the whole preview — the thread
        // count is still the useful half, and the UI degrades to "metered per
        // thread" rather than inventing a number.
        estimatePerThread(ctx.db, ctx.session.organizationId, ctx.session.userId).catch(() => null),
        isChannelSyncInProgress(ctx.db, ctx.session.organizationId, input.inboxId),
      ])
      // A human is looking at this one, so a precondition failure is surfaced.
      if (counted.isErr()) throw counted.error

      const { count, capped, cap, eligibleTagCount } = counted.value
      const sampleSize = Math.min(MAIL_RECLASSIFY_SAMPLE_SIZE, count)

      return {
        count,
        /** ⚠️ True means "more than `cap` matched" — render `cap+`, never a bare number. */
        capped,
        cap,
        eligibleTagCount,
        /**
         * Null when the org has no default model or the registry has no price;
         * 0 when the org is on its own API key and will not be charged at all.
         *
         * ⚠️ `Math.ceil`, not `usdToCredits`'s `Math.round`. Rounding to nearest
         * lets a small run quote 0 credits while still costing something, which
         * reads as "free" — every other rounding decision in this estimate leans
         * high and so must this one.
         */
        estimatedCredits: perThread === null ? null : ceilCredits(perThread.usd * count),
        /** False when the org uses its own API key: nothing is metered. */
        billed: perThread?.billed ?? true,
        sampleSize,
        sampleCredits: perThread === null ? null : ceilCredits(perThread.usd * sampleSize),
        /** 07 R-Q8 — a run started mid-backfill misses everything still arriving. */
        syncInProgress,
      }
    }),

  /**
   * Enqueue a sample of ~100 threads (07 §2.11, R6).
   *
   * ⚠️ It applies nothing and writes no marker, so there is nothing to undo — but
   * it still costs one inference per thread and still meters credits. That is why
   * it is gated exactly like the opt-in and audited like it.
   *
   * The preconditions are re-asserted here rather than left to the worker:
   * `runMailReclassifySample` refuses a non-opted-in inbox itself (07 invariant
   * 6), but a refusal on the queue is a log line nobody is watching, whereas this
   * one lands in the dialog the user is looking at.
   */
  startReclassifySample: capabilityProcedure
    .input(reclassifyScopeInput)
    .mutation(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      // 07 R-Q8 — block, do not queue-and-hope. Starting mid-backfill races the
      // sync and samples a mailbox that is still filling up.
      if (await isChannelSyncInProgress(ctx.db, ctx.session.organizationId, input.inboxId)) {
        throw new ConflictError(
          'This inbox is still syncing. Wait for the sync to finish, then classify its history.'
        )
      }

      const counted = await countReclassifiableThreads(ctx.db, {
        organizationId: ctx.session.organizationId,
        inboxId: input.inboxId,
        range: input.range,
        mode: input.mode,
      })
      if (counted.isErr()) throw counted.error
      if (counted.value.count === 0) {
        throw new BadRequestError('There are no conversations in that range to classify.')
      }

      const queued = await enqueueMailReclassifySample({
        organizationId: ctx.session.organizationId,
        inboxId: input.inboxId,
        range: input.range,
        mode: input.mode,
        requestedByUserId: ctx.session.userId,
      })
      if (queued.isErr()) throw queued.error

      // "Somebody pointed a model at this mailbox's history" is exactly the kind
      // of spend that should never be untraceable — same reasoning as the opt-in.
      await recordAuditFromCtx(ctx, {
        category: 'settings',
        action: 'mail.classification.sample_started',
        targetType: 'Inbox',
        targetId: input.inboxId,
        metadata: {
          range: input.range,
          mode: input.mode,
          threadsInScope: counted.value.count,
          sampleSize: Math.min(MAIL_RECLASSIFY_SAMPLE_SIZE, counted.value.count),
        },
      })

      return queued.value
    }),

  /**
   * Poll one inbox's sample — the dialog's results (07 §3.3) and the card row's
   * progress surface (07 §3.1) read the same status.
   *
   * `null` means no sample has been run recently: the job carries its report as
   * its return value and is reaped an hour after it completes, so "no job" and
   * "no result any more" are deliberately the same answer.
   */
  getReclassifySampleStatus: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      return await getMailReclassifySampleStatus(ctx.session.organizationId, input.inboxId)
    }),

  /**
   * Stop a sample (07 §2.5 — "a long run must be stoppable from the UI").
   *
   * Safe at any point because a sample commits nothing. Returns `false` when the
   * job is already running: BullMQ cancellation is the worker's abort signal,
   * which the run honours between threads, so the UI reports "stopping" rather
   * than claiming it stopped.
   */
  cancelReclassifySample: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      const removed = await cancelMailReclassifySample(ctx.session.organizationId, input.inboxId)
      return { removed }
    }),
})
