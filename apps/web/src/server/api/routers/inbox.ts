// apps/web/src/server/api/routers/inbox.ts

import { getCachedUserMailVisibility, getOrgCache } from '@auxx/lib/cache'
import { claimPersonalInbox, deletePersonalInbox } from '@auxx/lib/channels'
import {
  inboxDefKeyOf,
  loadInboxDefKeys,
  resolveInboxDefKey,
  toInboxRecordId,
} from '@auxx/lib/inbox-record-ids'
import { assertInboxFloorFeature, InboxService, setInboxFloor } from '@auxx/lib/inboxes'
import { PermissionKey } from '@auxx/lib/permissions'
import { inboxLensFor, type Lens } from '@auxx/lib/permissions/visibility'
import { ThreadMutationService } from '@auxx/lib/threads'
import { parseRecordId, type RecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { recordAuditFromCtx } from '~/server/api/audit-context'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * The mail front door (plan 40 §5.3) — `Area.inboxes` at `Read`.
 *
 * This router deliberately MIXES procedure types and the split follows the
 * OBJECT, not the file (§1.0): the inbox INVENTORY (create, delete, and routing
 * a channel to an inbox) is `channels.manage`, while working with a given inbox
 * — its lens map, its floor, its channel list, its movable-thread count — sits
 * behind this key. Do not collapse the two.
 *
 * A member whose only mail access is one explicit inbox grant still passes:
 * `composeUserCapabilities` synthesizes the area's Read rung from their instance
 * rows (`instanceDerivedKeys`), so the delegated non-admin inbox Manager is not
 * shut out by a profile at `inboxes: None`.
 */
const mailProcedure = permissionProcedure(PermissionKey.inboxesView)

/**
 * Inbox-manage gate: org admin or an inbox `admin` grant (Manager delegation).
 * Personal-channel owners hold the admin grant on their own personal inbox.
 *
 * The RecordId handed in MUST carry the inbox instance's ACTUAL definition
 * (plan 40 §3 / 40a §5.1): `canManageInboxAccess` → `hasPermission` matches
 * `ResourceAccess.entityDefinitionId` LITERALLY, and data migration 060 re-keys
 * a personal mailbox's grant rows to `'personal_inbox'`. Mint bare instance ids
 * with {@link toInboxRecordId}, never `toRecordId('inbox', …)`, or this gate
 * 403s the personal mailbox's own owner.
 */
async function requireInboxManageAccess(
  inboxService: InboxService,
  recordId: RecordId,
  userId: string
): Promise<void> {
  if (!(await inboxService.canManageInboxAccess(recordId, userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins or inbox managers can manage this inbox',
    })
  }
}

/**
 * Re-key an inbox RecordId that arrived from the client onto the definition the
 * INSTANCE actually lives on (plan 40 §3 / 40a §5.1) — the funnel half of the
 * same invariant `canonicalMailRecordId` enforces in `resourceAccess.ts`.
 *
 * **The def part of an incoming inbox RecordId is not evidence.** The FE mints
 * it from `useResource('inboxes').id` (`inbox-detail.tsx`,
 * `settings/channels/_components/integration-routing.tsx`) and from the record
 * layer's `record.recordId` (`use-inbox.ts` → the inbox picker) — both the def
 * **CUID**, never the `'inbox'` slug. `canManageInboxAccess` → `hasPermission`
 * matches `ResourceAccess.entityDefinitionId` **literally**, so a CUID-keyed
 * RecordId matches no grant row at all. Until plan 40 phase 2 that was masked by
 * the `vis.isAdmin` short-circuit inside `canManageInboxAccess` and only bit a
 * non-admin inbox Manager; phase 2 deleted that short-circuit (§4.2), which
 * makes it deny **everyone**, admins included.
 *
 * Resolution is by INSTANCE, not by translating the caller's def part:
 * `buildDefIdToSlug` would faithfully resolve the shared def's CUID to
 * `'inbox'`, which is still the wrong answer for a personal mailbox — the FE
 * asked for `useResource('inboxes')` regardless of which def the instance sits
 * on. {@link toInboxRecordId} reads the merged `inboxes` org cache instead, so
 * it is right for both defs and across the whole 059 → 060 window, and falls
 * back to `'inbox'` (closed) for an id the cache does not know.
 *
 * Fixed at the router rather than in the two components deliberately: the
 * components need the CUID-keyed RecordId anyway — it is what `useInbox` /
 * `useRecord` read the inbox's fields with — so a client-side fix would mean
 * carrying two RecordIds per inbox and would still leave the next caller free to
 * repeat the bug. Normalizing at the funnel covers the picker, both components
 * and anything added later.
 *
 */
async function canonicalInboxRecordId(
  organizationId: string,
  recordId: RecordId
): Promise<RecordId> {
  return toInboxRecordId(organizationId, parseRecordId(recordId).entityInstanceId)
}

/**
 * {@link canonicalInboxRecordId} for a PAIR, on one `org:inboxes` read —
 * `loadInboxDefKeys`' own contract ("build this ONCE per batch"), and what
 * `moveIntegrationThreads`' two ends want.
 */
async function canonicalInboxRecordIdPair(
  organizationId: string,
  first: RecordId,
  second: RecordId
): Promise<[RecordId, RecordId]> {
  const defKeys = await loadInboxDefKeys(organizationId)
  const canonical = (recordId: RecordId): RecordId => {
    const instanceId = parseRecordId(recordId).entityInstanceId
    return toRecordId(inboxDefKeyOf(defKeys, instanceId), instanceId)
  }
  return [canonical(first), canonical(second)]
}

/** Schema for creating an inbox */
const createInboxSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'PAUSED']).optional(),
  defaultLens: z.enum(['none', 'metadata', 'subject', 'full']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

/** Schema for managing integrations - uses RecordId for consistency */
const integrationSchema = z.object({
  recordId: recordIdSchema,
  integrationId: z.string(),
  isDefault: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

export const inboxRouter = createTRPCRouter({
  /**
   * The caller's effective lens per inbox (mail-permissions §6.4) — drives
   * the FE's per-lens realtime channel subscriptions and, later, redacted
   * rendering. Two org-cache reads, no DB. Inboxes at `none` are omitted.
   * `isAdmin` additionally authorizes the residual `none` (triage) channel.
   *
   * Also carries each inbox's ORG-WIDE FLOOR (plan 40 §6). That floor used to be
   * a FieldValue the FE read straight off the inbox record; it is now the
   * `role:org_member` `ResourceAccess` baseline row, which the record layer
   * cannot see. Rather than a per-inbox `resourceAccess.forInstance` query
   * behind every access badge, it rides along on the query the sidebar already
   * runs — the `org:inboxes` cache derives it, so this costs nothing extra. It
   * discloses no more than `inbox_default_lens` did on the record itself.
   */
  myLenses: mailProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const userId = ctx.session.user.id
    const [viewer, inboxes] = await Promise.all([
      getCachedUserMailVisibility(userId, organizationId),
      getOrgCache().get(organizationId, 'inboxes'),
    ])
    const lenses: Record<string, Exclude<Lens, 'none'>> = {}
    const floors: Record<string, Lens> = {}
    for (const inbox of inboxes) {
      const lens = inboxLensFor(viewer, inbox.id)
      if (lens !== 'none') lenses[inbox.id] = lens
      floors[inbox.id] = inbox.defaultLens
    }
    return { isAdmin: viewer.isAdmin, lenses, floors }
  }),

  /**
   * Author an inbox's ORG-WIDE FLOOR — the "Everyone / Restricted" control on
   * the inbox form (plan 40 §6).
   *
   * Replaces the `inbox_default_lens` field write, which stopped meaning
   * anything when phase 2 moved the read path onto `ResourceAccess` rows: the
   * form kept saving a field nothing consulted, so changing an inbox's org-wide
   * access level was a live no-op. The floor is now the `role:org_member`
   * baseline row (`none` ⇒ the v2 RESTRICTION marker, `metadata`/`subject` ⇒
   * `view` with the lens preserved, `full` ⇒ no row at all).
   *
   * It carries the same two gates `guardInboxDefaultLens` enforced on the field,
   * because the hook cannot fire for a write that is no longer a field write:
   *  - **Manager of THIS inbox** (or the OWNER short-circuit inside
   *    `checkAccess`) — not `channels.manage`, which governs the org's inbox
   *    INVENTORY rather than any one inbox's audience (§1.0).
   *  - **Enterprise `mailPermissions`** for any sub-`full` floor. Note this is
   *    NOT covered by `assertMailSharingFeature` on the generic sharing router:
   *    that gate keys on a non-`full` `lens`, and the Restricted floor is
   *    `permission: 'none'` with a NULL lens, so it would sail straight past.
   *
   * `toInboxRecordId` first: the client's def part is a guess (the FE mints
   * inbox RecordIds from `useResource('inboxes').id`, the def CUID), and a wrong
   * def matches no grant row — so both the assert below and the row this writes
   * would land in the wrong keyspace.
   */
  setAccessFloor: mailProcedure
    .input(
      z.object({
        inboxId: z.string(),
        floorLens: z.enum(['none', 'metadata', 'subject', 'full']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const recordId = await toInboxRecordId(organizationId, input.inboxId)
      await requireInboxManageAccess(inboxService, recordId, userId)

      // A personal mailbox has no org-wide floor by construction — that is what
      // `personal_inbox`'s `baselineAtCreate: true` means, and a baseline row on
      // one would hand every member the owner's private mail.
      if (parseRecordId(recordId).entityDefinitionId === 'personal_inbox') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A personal inbox has no organization-wide access level',
        })
      }

      await assertInboxFloorFeature(ctx.db, organizationId, userId, input.floorLens)
      await setInboxFloor({ db: ctx.db, organizationId, userId }, recordId, input.floorLens)

      await recordAuditFromCtx(ctx, {
        category: 'security',
        action: 'permission.set',
        targetType: 'Resource',
        targetId: String(recordId),
        newState: { granteeType: 'role', granteeId: 'org_member', floorLens: input.floorLens },
        metadata: { scope: 'instance', kind: 'inbox-floor' },
      })
      return { success: true }
    }),

  /**
   * Get integrations for an inbox. Which channels feed an inbox is inbox
   * CONTENT, so it takes the view gate, not the manage gate — but it did take
   * no gate at all before plan 40 phase 0a, which made every org's channel
   * routing readable by any member.
   *
   * **Now `assertViewInstance`, as plan §5.3 prescribes** — phase 0a had to gate
   * it on `InboxService.hasUserAccess` instead, because the two predicates
   * genuinely disagreed on the majority path: `effectiveInstanceLevel` read the
   * org-wide governed set as "carries ≥1 row for ANYONE", and `createInbox`
   * writes its creator a `user @ admin` row on every inbox, so every non-grantee
   * — ordinary member and default ADMIN alike — resolved `undefined` on every
   * inbox in the org. The 2026-07-29 capability fix (`governingInstanceIds` +
   * own-row-first) adopted mail's `rowGoverned` predicate verbatim, which closed
   * that gap; `mail-gap-closures.test.ts`'s gap-3 block pins the agreement.
   *
   * **The def key is resolved from the INSTANCE, never guessed.** A hard-coded
   * `'inbox'` fails OPEN on a personal mailbox: `personal_inbox` is the
   * `baselineAtCreate: true` key, so its absent-row answer is "denied", while
   * `inbox`'s is the area fallback — asking the wrong key hands every member the
   * org-shared default on somebody's private mail. {@link resolveInboxDefKey}
   * reads the merged `inboxes` org cache and falls back CLOSED (`'inbox'`, whose
   * grant rows a moved mailbox no longer carries). Never derive it from
   * `isPersonal`: the marker and the def disagree by design for the whole
   * 059 → 060 window.
   *
   * **One narrowing, deliberate and worth knowing about:** a mail admin
   * (`inboxes: Full`) holding no row on ANOTHER member's personal mailbox used to
   * pass here, because §4.4's `metadata` floor makes `inboxLens[id] !== 'none'`
   * true for them. It no longer does. That floor is a THREAD view ("something
   * exists, participants, timestamps"); an inbox's channel routing is its
   * configuration, which §1.3/§5.3 put with the Manager. Claim/delete of an
   * orphaned personal mailbox is `channels.manage` and is unaffected.
   */
  getIntegrations: mailProcedure
    .input(z.object({ inboxId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id

      // Before the lookup, so a member without access cannot distinguish an
      // inbox they may not see from one that does not exist. `resolveInboxDefKey`
      // is an org-CACHE read, not a DB read, so it leaks no existence signal of
      // its own: an id nobody may see resolves to the shared def and denies.
      ctx.capabilities.assertViewInstance(
        await resolveInboxDefKey(organizationId, input.inboxId),
        input.inboxId
      )

      const inboxService = new InboxService(ctx.db, organizationId, userId)
      const inbox = await inboxService.getInboxWithIntegrationsById(input.inboxId)

      if (!inbox) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inbox not found' })
      }

      return inbox.integrations
    }),

  /**
   * Create a new inbox.
   *
   * Inventory, not mail work: creating an inbox is provisioning a destination
   * for channels, so it sits on `channels.manage` alongside connect/disconnect
   * (plan 40 §1.0). Ungated before phase 0a — which is step 1 of the §5.1
   * escalation, since `createInbox` makes the creator the new inbox's Manager.
   */
  create: permissionProcedure(PermissionKey.channelsManage)
    .input(createInboxSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const created = await inboxService.createInbox(input)
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.created',
        targetType: 'Inbox',
        targetId: (created as { id?: string } | null)?.id ?? null,
        metadata: { name: input.name },
      })
      return created
    }),

  /**
   * Delete an inbox. Inventory (`channels.manage`, §1.0) AND this inbox's
   * Manager — the coarse key says you may shape the org's inbox inventory, the
   * instance assert says you may shape THIS inbox.
   */
  delete: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      await requireInboxManageAccess(
        inboxService,
        await toInboxRecordId(organizationId, input.inboxId),
        userId
      )

      await inboxService.deleteInboxById(input.inboxId)
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.deleted',
        targetType: 'Inbox',
        targetId: input.inboxId,
      })
      return { success: true }
    }),

  /**
   * Claim an ORPHANED personal inbox (mail-permissions §11.4): clears the
   * personal marker + owner, converting it into a normal restricted org
   * inbox. Rejected while the owner is still a member.
   */
  claimPersonal: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await claimPersonalInbox({
        organizationId,
        adminUserId: ctx.session.user.id,
        inboxId: input.inboxId,
      })
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.personal.claimed',
        targetType: 'Inbox',
        targetId: input.inboxId,
      })
      return { success: true }
    }),

  /**
   * Delete an ORPHANED personal inbox (§11.4): destroys its channels'
   * threads/messages and the inbox itself. Rejected while the owner is
   * still a member.
   */
  deletePersonal: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ inboxId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      await deletePersonalInbox({
        organizationId,
        adminUserId: ctx.session.user.id,
        inboxId: input.inboxId,
      })
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.personal.deleted',
        targetType: 'Inbox',
        targetId: input.inboxId,
      })
      return { success: true }
    }),

  /**
   * Route a channel to an inbox.
   *
   * A join between two separately-governed objects, so it takes BOTH gates
   * (plan 40 §1.0/§5.1): `channels.manage` for the channel side, and Manager on
   * the inbox side — on the target, and on the SOURCE whenever the channel is
   * already routed elsewhere, because `InboxService.addIntegration` re-points
   * the existing link rather than adding a second one.
   *
   * The source assert is the half that turns a read into a hijack. Without it,
   * any member could create an inbox (Manager of it by construction), route the
   * company support channel in, and take delivery of every future message at
   * `defaultLens: 'full'` while the real inbox went silent.
   */
  addIntegration: permissionProcedure(PermissionKey.channelsManage)
    .input(integrationSchema)
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      // BEFORE the gate: the client's def part is a guess, and a wrong one
      // matches no `ResourceAccess` row, so the assert would deny the inbox's
      // own Manager.
      const recordId = await canonicalInboxRecordId(organizationId, input.recordId)
      await requireInboxManageAccess(inboxService, recordId, userId)

      // Personal channels are permanently bound to their personal inbox (§11):
      // the only sanctioned exits are admin claim or delete, and nothing routes
      // INTO a personal inbox via this endpoint (provisioning links internally).
      const [targetInbox, currentInbox] = await Promise.all([
        inboxService.getInbox(recordId),
        inboxService.getIntegrationInbox(input.integrationId),
      ])
      if (currentInbox?.isPersonal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Personal channels cannot be re-routed',
        })
      }
      if (targetInbox?.isPersonal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Channels cannot be routed into a personal inbox',
        })
      }

      // Re-routing is a move OUT of the source inbox as much as a move into the
      // target, so both ends are asserted — the same shape `moveIntegrationThreads`
      // already uses. `repointFromInboxId` carries the authorization decision
      // into the service, which re-checks it inside the write transaction so a
      // concurrent re-route cannot land on an inbox nobody authorized.
      const targetInboxId = parseRecordId(recordId).entityInstanceId
      const sourceInbox = currentInbox && currentInbox.id !== targetInboxId ? currentInbox : null
      if (sourceInbox) {
        // `Inbox.recordId` is minted server-side from the instance's own def, so
        // it needs no canonicalization — it never crossed the wire.
        await requireInboxManageAccess(inboxService, sourceInbox.recordId, userId)
      }

      const result = await inboxService.addIntegration(
        recordId,
        input.integrationId,
        input.isDefault,
        input.settings,
        { repointFromInboxId: sourceInbox?.id }
      )
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.integration_added',
        targetType: 'Inbox',
        targetId: String(recordId),
        metadata: { integrationId: input.integrationId, fromInboxId: sourceInbox?.id ?? null },
      })
      return result
    }),

  /**
   * Count an integration's threads currently sitting in a given inbox.
   * Used to size the "move existing conversations?" prompt when re-routing a
   * channel to a different inbox.
   *
   * No canonicalization here, deliberately: `countIntegrationThreadsInInbox`
   * reads `getInstanceId(fromInboxRecordId)` and never looks at the definition,
   * so the client's CUID-keyed RecordId has always resolved correctly. Adding a
   * re-key would be inert ceremony.
   */
  countMovableThreads: mailProcedure
    .input(z.object({ integrationId: z.string(), fromInboxRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const viewer = await getCachedUserMailVisibility(userId, organizationId)
      const threadMutation = new ThreadMutationService(
        organizationId,
        ctx.db,
        undefined,
        userId,
        viewer
      )
      return threadMutation.countIntegrationThreadsInInbox(
        input.integrationId,
        input.fromInboxRecordId
      )
    }),

  /**
   * Move an integration's existing conversations from one inbox to another.
   * Re-routing the channel ({@link addIntegration}) only affects future mail;
   * this relocates the threads that are already in `fromInboxRecordId`.
   *
   * The companion half of a re-route, so it takes the same pair of gates:
   * `channels.manage` plus Manager on BOTH inboxes (§5.1).
   */
  moveIntegrationThreads: permissionProcedure(PermissionKey.channelsManage)
    .input(
      z.object({
        integrationId: z.string(),
        fromInboxRecordId: recordIdSchema,
        toInboxRecordId: recordIdSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const socketId = ctx.headers?.get?.('x-realtime-socket-id') ?? undefined

      // Moving threads touches both inboxes — require manage access on each
      // side, on the def each INSTANCE actually lives on (the client sends the
      // shared def's CUID for both ends).
      const inboxService = new InboxService(ctx.db, organizationId, userId)
      const [sourceRecordId, targetRecordId] = await canonicalInboxRecordIdPair(
        organizationId,
        input.fromInboxRecordId,
        input.toInboxRecordId
      )
      await requireInboxManageAccess(inboxService, sourceRecordId, userId)
      await requireInboxManageAccess(inboxService, targetRecordId, userId)

      // Threads may not be moved into or out of a personal inbox (§11 isolation).
      const [fromInbox, toInbox] = await Promise.all([
        inboxService.getInbox(sourceRecordId),
        inboxService.getInbox(targetRecordId),
      ])
      if (fromInbox?.isPersonal || toInbox?.isPersonal) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Conversations cannot be moved into or out of a personal inbox',
        })
      }

      const viewer = await getCachedUserMailVisibility(userId, organizationId)
      const threadMutation = new ThreadMutationService(
        organizationId,
        ctx.db,
        socketId,
        userId,
        viewer
      )

      const result = await threadMutation.moveIntegrationThreadsToInbox(
        input.integrationId,
        sourceRecordId,
        targetRecordId
      )
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.threads_moved',
        targetType: 'Inbox',
        targetId: String(targetRecordId),
        metadata: {
          integrationId: input.integrationId,
          fromInboxRecordId: String(sourceRecordId),
          count: result.count,
        },
      })
      return result
    }),

  /**
   * Unroute a channel from an inbox: `channels.manage` AND Manager on the
   * inbox (§5.1).
   *
   * There is no separate source assert to make here — the delete is keyed on
   * `(inboxId, integrationId)`, so it can only ever unlink the inbox named in
   * the input. The target IS the source; a caller aiming this at a channel
   * routed to some other inbox deletes nothing.
   */
  removeIntegration: permissionProcedure(PermissionKey.channelsManage)
    .input(z.object({ inboxId: z.string(), integrationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const userId = ctx.session.user.id
      const inboxService = new InboxService(ctx.db, organizationId, userId)

      const recordId = await toInboxRecordId(organizationId, input.inboxId)
      await requireInboxManageAccess(inboxService, recordId, userId)
      const result = await inboxService.removeIntegration(recordId, input.integrationId)
      await recordAuditFromCtx(ctx, {
        category: 'integrations',
        action: 'inbox.integration_removed',
        targetType: 'Inbox',
        targetId: input.inboxId,
        metadata: { integrationId: input.integrationId },
      })
      return result
    }),
})
