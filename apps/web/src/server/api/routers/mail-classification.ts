// apps/web/src/server/api/routers/mail-classification.ts

import { onCacheEvent } from '@auxx/lib/cache'
import { getOrganizationSetting, updateOrganizationSetting } from '@auxx/lib/settings'
import { TagService } from '@auxx/lib/tags'
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

export const mailClassificationRouter = createTRPCRouter({
  /**
   * The card's whole state: is this inbox opted in, and is there anything for
   * the classifier to apply.
   *
   * Authorized exactly like the write. A read is a disclosure too — answering
   * "not opted in" for a colleague's personal mailbox would confirm it exists.
   */
  getInboxSettings: capabilityProcedure
    .input(z.object({ inboxId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const authority = await loadMailFilterAuthority(ctx)
      assertCanConfigureInboxAutomation(authority, input.inboxId)

      const [inboxIds, eligibleTagCount] = await Promise.all([
        readOptedInInboxIds(ctx.session.organizationId),
        countEligibleTags(ctx.session.organizationId, ctx.session.userId, ctx.db),
      ])

      return { enabled: inboxIds.includes(input.inboxId), eligibleTagCount }
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
})
