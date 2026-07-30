// packages/lib/src/inboxes/inbox-service.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { ResourceGranteeType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { parseRecordId, type RecordId, toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
import { getCachedEntityDefId, getUserCache, onCacheEvent } from '../cache'
import { ConflictError, NotFoundError } from '../errors'
import type { Lens } from '../permissions/visibility/lens'
import type { InboxDef } from '../resource-access/mail-sharing-defs'
import { hasPermission, setInstanceAccess } from '../resource-access/resource-access-service'
import type { ResourceAccessContext } from '../resource-access/types'
import { listAll, UnifiedCrudHandler } from '../resources/crud'
import { assertInboxFloorFeature, readInboxFloors, setInboxFloor } from './inbox-floor'
import type { CreateInboxInput, Inbox, InboxWithIntegrations, UpdateInboxInput } from './types'

const logger = createScopedLogger('inbox-service')

/**
 * Helper to extract instance ID from RecordId
 */
function getInstanceId(recordId: RecordId): string {
  return parseRecordId(recordId).entityInstanceId
}

/* ═══════════════════════════════════════════════════════════════════════════
 * DEF-SCOPED QUERY AUDIT (plan 40 §3.4 — required pass, do not delete)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A mailbox lives on ONE of two definitions: `inbox` (org-shared) or
 * `personal_inbox` (one member's connected account, seeded by entity migration
 * 059, populated by data migration 060). Every def-scoped query in this file is
 * classified below; a future reader must not have to guess which.
 *
 * **UNIONS BOTH DEFS** (reads that must see every mailbox):
 *  - {@link InboxService.getInboxes} — feeds the `org:inboxes` cache and ~20
 *    consumers (mail visibility, counts, audience, ingest meta, mail-trigger
 *    guard, sidebar). Listing one def here is the single highest-leverage
 *    silent bug in the whole plan (40a §0.1).
 *
 * **RESOLVES THE INSTANCE'S ACTUAL DEF** (per-instance reads/writes — the def
 * is looked up, never assumed, because callers pass a bare instance id):
 *  - {@link InboxService.resolveInbox} (and therefore `getInbox`,
 *    `getInboxById`, `getInboxWithIntegrations*`) — canonicalizes the RecordId
 *    off `EntityInstance.entityDefinitionId` before reading FieldValues. A
 *    wrong def prefix here silently resolves the OTHER def's CustomField ids
 *    and yields an all-defaults inbox, not an error.
 *  - {@link InboxService.updateInboxById} / {@link InboxService.deleteInboxById}
 *    — `crudHandler.update`/`delete` dispatch field writes and hooks off the
 *    RecordId's def.
 *
 * **DELIBERATELY SHARED-ONLY** (`'inbox'` is correct and must stay):
 *  - {@link InboxService.createInbox} defaults `entityDefinitionKey` to
 *    `'inbox'`. Personal mailboxes are created ONLY by the personal-connect
 *    provisioning path, which passes the key explicitly (plan 40 §3.2 / 40a
 *    §8.4 — the generic create path must never accept `personal_inbox`).
 *
 * **THE FLOOR IS A ROW, NOT A FIELD** (plan 40 §6). `Inbox.defaultLens` is
 * derived from the `role:org_member` `ResourceAccess` baseline row via
 * `readInboxFloors`; `inbox_default_lens` is neither read nor written here any
 * more. It is one org-scoped query beside `getInboxes()`' listings (this
 * function backs the `org:inboxes` cache, so once per org per TTL) and one
 * instance-scoped query in `resolveInbox`.
 *  - {@link InboxService.getOrCreateSharedInbox} — by name and by contract the
 *    org's shared forwarding destination.
 *
 * **DEF-AGNOSTIC — no def in the query at all** (keyed on the instance id, so
 * both defs work unchanged): `deleteInbox`'s `InboxIntegration` /
 * `ResourceAccess` deletes, `addIntegration`, `removeIntegration`,
 * `addIntegrationById`, `getIntegrationInbox`, `hasUserAccess`.
 *
 * **NOT DEF-AWARE, AND OWNED ELSEWHERE**: {@link InboxService.canManageInboxAccess}
 * forwards the caller's RecordId to `hasPermission`, which matches
 * `ResourceAccess.entityDefinitionId` literally. Callers that mint
 * `toRecordId('inbox', id)` for a personal mailbox (`inbox.ts:106,155,390`)
 * therefore miss its re-keyed grant rows after 060 — that is 40a §5.1's
 * RecordId-minting sweep, tracked there, not fixed here.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Field-value reads surface SINGLE_SELECT values as one-element arrays (the
 * UI-uniform format). Unwrap to a scalar so downstream strict comparisons
 * (`status === 'ACTIVE'`, lens checks) don't silently misfire.
 */
function scalarFieldValue(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * Service for managing inboxes.
 * Uses RecordId branded types throughout for type safety.
 * Delegates core CRUD to UnifiedCrudHandler, uses ResourceAccess helpers for permissions.
 */
export class InboxService {
  private crudHandler: UnifiedCrudHandler
  private db: Database
  private ctx: ResourceAccessContext

  constructor(
    db: Database,
    private organizationId: string,
    private userId?: string
  ) {
    this.db = db ?? defaultDb
    this.crudHandler = new UnifiedCrudHandler(organizationId, userId ?? '', this.db)
    this.ctx = { db: this.db, organizationId, userId: userId ?? '' }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFINITION RESOLUTION (plan 40 §3.4 — see the audit block above)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The inbox definitions this org actually has, in read order.
   *
   * `inbox` is seeded from day one; `personal_inbox` only exists once entity
   * migration 059 has run for this org. `listAll` THROWS on an unknown entity
   * key, and this list feeds the `org:inboxes` cache — every mail read path
   * hangs off it — so an org mid-migration must degrade to shared-only rather
   * than take mail down. One cached lookup, no DB round-trip.
   */
  private async availableInboxDefKeys(): Promise<InboxDef[]> {
    const personalDefId = await getCachedEntityDefId(this.organizationId, 'personal_inbox')
    return personalDefId ? ['inbox', 'personal_inbox'] : ['inbox']
  }

  /** Map an `EntityDefinition.id` to its inbox def slug (falls back to shared). */
  private async defKeyForDefId(entityDefinitionId: string): Promise<InboxDef> {
    const personalDefId = await getCachedEntityDefId(this.organizationId, 'personal_inbox')
    return personalDefId && entityDefinitionId === personalDefId ? 'personal_inbox' : 'inbox'
  }

  /**
   * The definition an inbox instance actually lives on. Used by every entry
   * point that takes a bare instance id, so a personal mailbox is never read or
   * written through the shared def's CustomFields.
   */
  private async defKeyForInstance(instanceId: string): Promise<InboxDef> {
    const row = await this.db.query.EntityInstance.findFirst({
      where: and(
        eq(schema.EntityInstance.id, instanceId),
        eq(schema.EntityInstance.organizationId, this.organizationId)
      ),
      columns: { entityDefinitionId: true },
    })
    return row ? this.defKeyForDefId(row.entityDefinitionId) : 'inbox'
  }

  /** Canonical (slug-keyed) RecordId for a bare inbox instance id. */
  private async recordIdForInstance(instanceId: string): Promise<RecordId> {
    return toRecordId(await this.defKeyForInstance(instanceId), instanceId)
  }

  /**
   * The org-wide floor for one inbox, from its `role:org_member` baseline row
   * (plan 40 §6). Absent row ⇒ `full`, the org-shared default the
   * `Area.inboxes` fallback supplies.
   *
   * A personal mailbox has NO org-wide floor by construction — the
   * `baselineAtCreate: true` key means "no row ⇒ no access" — so it reports
   * `none` regardless of what rows exist. Reporting the `full` default there
   * would put "Everyone · Full access" on a private mailbox's badge, and would
   * put every member into `getFullLensAudienceForInbox`'s count-delta fan-out
   * for it.
   */
  private static floorFor(
    defKey: InboxDef,
    instanceId: string,
    floors: Record<string, Lens>
  ): Lens {
    if (defKey === 'personal_inbox') return 'none'
    return floors[instanceId] ?? 'read'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS (delegated to UnifiedCrudHandler)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new inbox (returns Inbox which includes recordId).
   *
   * SHARED-ONLY by default (`entityDefinitionKey` ?? `'inbox'`). Personal
   * mailboxes come from the provisioning path alone (plan 40 §3.2), which passes
   * `'personal_inbox'` and neither `isPersonal` nor `defaultLens` — the def
   * implies both and carries neither field (40a §1.2).
   *
   * **The floor is a `ResourceAccess` row, not a FieldValue** (plan 40 §6).
   * `inbox_default_lens` is no longer written here: the read path stopped
   * consulting it in phase 2, so writing it made inbox creation with a
   * non-default floor silently produce an org-visible inbox. It is written after
   * the creator's Manager grant, deliberately — a floor of `none` on an inbox
   * with no Manager yet would be an inbox nobody can reach.
   */
  async createInbox(input: CreateInboxInput): Promise<Inbox> {
    logger.info('Creating new inbox', { organizationId: this.organizationId, name: input.name })

    const defKey: InboxDef = input.entityDefinitionKey ?? 'inbox'
    // `null` = "this def has no org-wide floor at all", which is the
    // `personal_inbox` case and NOT the same as a floor of `none`: there is
    // nothing to author, nothing to gate, and nothing a caller can pass that
    // would change it (`baselineAtCreate: true` — no row ⇒ no access).
    const floor: Lens | null = defKey === 'personal_inbox' ? null : (input.defaultLens ?? 'read')

    // Before any write: the same Enterprise gate `guardInboxDefaultLens` ran on
    // the field, so a gated org cannot create its way past the paywall.
    if (floor) await assertInboxFloorFeature(this.db, this.organizationId, this.userId, floor)

    const values: Record<string, unknown> = {
      inbox_name: input.name,
      inbox_description: input.description ?? null,
      inbox_color: input.color ?? 'indigo',
      inbox_status: input.status ?? 'ACTIVE',
      inbox_settings: input.settings ?? {},
    }
    // Only the personal connect provisioning path sets this — writing it
    // unconditionally would trip the owner-field guard for member creates.
    // There is no `isPersonal` counterpart any more: the DEF is the marker
    // (`entityDefinitionKey` above), and `inbox_is_personal` is gone.
    if (input.ownerUserId !== undefined) values.inbox_owner_user_id = input.ownerUserId

    const result = await this.crudHandler.create(defKey, values)
    const recordId = toRecordId(defKey, result.instance.id)

    // Creator becomes the inbox Manager (admin grant — may manage access).
    if (this.userId) {
      await setInstanceAccess(this.ctx, recordId, ResourceGranteeType.user, [
        { granteeId: this.userId, rung: 'admin' },
      ])
    }

    // `full` writes no row at all — the absent baseline IS the org-shared
    // default — so the common create takes no extra write.
    if (floor && floor !== 'read') {
      await setInboxFloor(
        { db: this.db, organizationId: this.organizationId, userId: this.userId },
        recordId,
        floor
      )
    }

    // Inbox floors affect every member's visibility context.
    await onCacheEvent('inbox.created', { orgId: this.organizationId, broadcastUserKeys: true })

    return this.resolveInbox(recordId)
  }

  /**
   * Get a single inbox by RecordId
   */
  async getInbox(recordId: RecordId): Promise<Inbox | null> {
    const instance = await this.crudHandler.getById(recordId)
    return instance ? this.resolveInbox(recordId) : null
  }

  /**
   * Get a single inbox by raw ID (convenience method).
   *
   * The def prefix here is only a hint: {@link resolveInbox} canonicalizes off
   * the instance's real definition, and `getById` looks the instance up by id
   * alone — so this reads a personal mailbox correctly too, and the returned
   * `recordId` carries the right def.
   */
  async getInboxById(inboxId: string): Promise<Inbox | null> {
    return this.getInbox(toRecordId('inbox', inboxId))
  }

  /**
   * Update an inbox by RecordId.
   *
   * `defaultLens` is routed to the `role:org_member` baseline ROW (plan 40 §6),
   * not to `inbox_default_lens` — nothing has read that field since phase 2, so
   * a field write here would be exactly the no-op this slice exists to fix.
   */
  async updateInbox(recordId: RecordId, input: UpdateInboxInput): Promise<Inbox> {
    logger.info('Updating inbox', { recordId, input })

    const values: Record<string, unknown> = {}

    if (input.name !== undefined) values.inbox_name = input.name
    if (input.description !== undefined) values.inbox_description = input.description
    if (input.color !== undefined) values.inbox_color = input.color
    if (input.status !== undefined) values.inbox_status = input.status
    if (input.settings !== undefined) values.inbox_settings = input.settings
    if (input.ownerUserId !== undefined) values.inbox_owner_user_id = input.ownerUserId

    if (input.defaultLens !== undefined) {
      await assertInboxFloorFeature(this.db, this.organizationId, this.userId, input.defaultLens)
      await setInboxFloor(
        { db: this.db, organizationId: this.organizationId, userId: this.userId },
        recordId,
        input.defaultLens
      )
    }

    if (Object.keys(values).length > 0) {
      await this.crudHandler.update(recordId, values)
      await onCacheEvent('inbox.updated', { orgId: this.organizationId, broadcastUserKeys: true })
    }

    return this.resolveInbox(recordId)
  }

  /**
   * Update an inbox by raw ID (convenience method).
   *
   * Resolves the instance's actual definition: `crudHandler.update` dispatches
   * field writes and pre/post hooks off the RecordId's def, so a hard-coded
   * `'inbox'` prefix would write a personal mailbox through the shared def's
   * CustomField ids.
   */
  async updateInboxById(inboxId: string, input: UpdateInboxInput): Promise<Inbox> {
    return this.updateInbox(await this.recordIdForInstance(inboxId), input)
  }

  /**
   * Delete an inbox by RecordId.
   *
   * Refuses while an ACTIVE channel is still routed here: deleting the link
   * rows would leave the Integration enabled but orphaned — its sync jobs
   * fail forever with "Inbox integration not found". Callers must re-route
   * or disconnect the channels first (`deletePersonalInbox` soft-deletes its
   * integrations before calling this, so it passes).
   */
  async deleteInbox(recordId: RecordId): Promise<void> {
    const instanceId = getInstanceId(recordId)
    logger.info('Deleting inbox', { recordId, instanceId })

    const activeChannels = await this.db
      .select({ integrationId: schema.Integration.id })
      .from(schema.InboxIntegration)
      .innerJoin(
        schema.Integration,
        eq(schema.Integration.id, schema.InboxIntegration.integrationId)
      )
      .where(
        and(
          eq(schema.InboxIntegration.inboxId, instanceId),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt)
        )
      )
    if (activeChannels.length > 0) {
      throw new ConflictError(
        'This inbox still has connected channels. Move them to another inbox or disconnect them first.'
      )
    }

    // Delete related records first
    await this.db.transaction(async (tx) => {
      // Delete inbox integrations
      await tx
        .delete(schema.InboxIntegration)
        .where(eq(schema.InboxIntegration.inboxId, instanceId))

      // Delete resource access records
      await tx
        .delete(schema.ResourceAccess)
        .where(
          and(
            eq(schema.ResourceAccess.organizationId, this.organizationId),
            eq(schema.ResourceAccess.entityInstanceId, instanceId)
          )
        )
    })

    // Delete the entity instance
    await this.crudHandler.delete(recordId)

    await onCacheEvent('inbox.deleted', { orgId: this.organizationId, broadcastUserKeys: true })
    await onCacheEvent('channel.inbox-link.changed', { orgId: this.organizationId })
  }

  /**
   * Delete an inbox by raw ID (convenience method).
   *
   * Resolves the instance's actual definition — `crudHandler.delete` dispatches
   * off the RecordId's def (the link/grant deletes above are keyed on the
   * instance id and are def-agnostic either way).
   */
  async deleteInboxById(inboxId: string): Promise<void> {
    return this.deleteInbox(await this.recordIdForInstance(inboxId))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all inboxes for the organization — the UNION of both inbox
   * definitions (plan 40 §3.4).
   *
   * ONE merged list with the def carried per entry, deliberately: this backs
   * the `org:inboxes` cache, and the ~20 downstream consumers (mail visibility,
   * unread counts, realtime audience, ingest meta, the mail-trigger guard, the
   * sidebar) overwhelmingly do not care which def a mailbox is on — they filter
   * on the derived {@link Inbox.isPersonal}. Unioning here rather than in every
   * reader is what keeps that true. Sites that genuinely must exclude personal
   * mailboxes (channel routing targets, chat-widget destinations, workflow mail
   * triggers, automation scope) filter on `isPersonal`, as they do today.
   *
   * Listing only `'inbox'` here is 40a §0's top-ranked silent bug: personal
   * mailboxes would vanish from every mail read path with nothing thrown.
   */
  async getInboxes(): Promise<Inbox[]> {
    const ctx = { db: this.db, organizationId: this.organizationId, userId: this.userId ?? '' }
    const defKeys = await this.availableInboxDefKeys()

    // ONE floor query for the whole org, beside the per-def listings (plan 40
    // §6): `defaultLens` is now derived from the `role:org_member` baseline rows
    // rather than the `inbox_default_lens` FieldValue. This function backs the
    // `org:inboxes` cache, so the cost is one query per org per TTL — and every
    // downstream floor reader (the realtime/count-delta audience, the inbox
    // badges, the share popover's inherited-access footer) inherits the row
    // truth without a query of its own.
    const [perDef, floors] = await Promise.all([
      Promise.all(
        defKeys.map(async (defKey) => {
          const result = await listAll(ctx, { entityDefinitionId: defKey })
          return { defKey, items: result.items }
        })
      ),
      readInboxFloors(this.db, this.organizationId),
    ])

    return perDef.flatMap(({ defKey, items }) =>
      items.map((item) => this.transformToInbox(item, defKey, floors))
    )
  }

  /**
   * Get all inboxes visible to a user (effective lens above `none`) — a filter
   * over the cached `userInstanceGrants` context, no per-inbox ACL queries.
   *
   * No rank bypass (plan 40 §4.2): a default admin still sees every shared inbox,
   * because their `inboxes: Full` resolves to a `full` floor on every row-less
   * one, and still sees others' personal mailboxes, because the mail-operations
   * rung composes a `metadata` floor there (§4.4). What they no longer see is a
   * shared inbox explicitly restricted with `role:org_member @ none` that nobody
   * granted them.
   */
  async getInboxesForUser(userId: string): Promise<Inbox[]> {
    const vis = await getUserCache().get(userId, 'userInstanceGrants', this.organizationId)
    const inboxes = await this.getInboxes()
    return inboxes.filter((inbox) => (vis.inboxLens[inbox.id] ?? 'none') !== 'none')
  }

  /**
   * Check if user has access to an inbox (effective lens above `none`).
   * Cache read — replaces the former live ResourceAccess check.
   *
   * Rank-free since plan 40 §4.2, same reasoning as {@link getInboxesForUser}.
   */
  async hasUserAccess(recordId: RecordId, userId: string): Promise<boolean> {
    const vis = await getUserCache().get(userId, 'userInstanceGrants', this.organizationId)
    return (vis.inboxLens[getInstanceId(recordId)] ?? 'none') !== 'none'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Whether a user may manage this inbox's access (floor edits, grants): an
   * inbox `admin` grant — the Manager row (decision #3).
   *
   * **The `vis.isAdmin` bypass is deleted (plan 40 §4.2).** An ADMIN-ranked
   * member who holds no Manager row on this inbox can no longer manage its
   * access; every inbox writes its creator one (`createInbox`), and an OWNER
   * still resolves `admin` through `checkAccess`'s owner short-circuit — the ONE
   * remaining role bypass on that path — so the manager set is never empty and
   * an org is never locked out of an inbox it owns.
   *
   * ⚠ **`plans/permissions/v2/42-mail-access-requests.md` §3 resolves approvers
   * through this predicate.** Verified against this deletion (2026-07-29):
   *  - Plan 42's shipping lane is THREAD requests, whose approver set is
   *    `assertCanManageMailSharing`'s thread branch — inbox Managers, falling back
   *    to org admins. That branch keeps its `vis.isAdmin` read (plan 40 §2 scopes
   *    the deletion to the `inbox` branch), so rule 2 survives and null-`inboxId`
   *    threads still resolve a non-empty approver set. **No change needed.**
   *  - Plan 42's later INBOX lane, which rides on this function, still resolves a
   *    provably non-empty set (creator-Manager + OWNER) but a NARROWER one: org
   *    admins without a Manager row are no longer approvers. Plan 42 must state
   *    that rather than inheriting "all admins" from today's reading.
   */
  async canManageInboxAccess(recordId: RecordId, userId: string): Promise<boolean> {
    return hasPermission({ ...this.ctx, userId }, recordId, 'admin')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * The inbox an integration currently routes to, if any.
   */
  async getIntegrationInbox(integrationId: string): Promise<Inbox | null> {
    const link = await this.db.query.InboxIntegration.findFirst({
      where: eq(schema.InboxIntegration.integrationId, integrationId),
    })
    if (!link) return null
    return this.getInboxById(link.inboxId)
  }

  /**
   * Add an integration to an inbox.
   *
   * A channel routes to exactly ONE inbox (`InboxIntegration_integrationId_key`
   * is unique), so linking a channel that already routes somewhere is a MOVE,
   * not an add: every future message silently changes destination. That is a
   * privileged act on the SOURCE inbox, and this service cannot authorize it —
   * it reads no member capabilities. So callers must acknowledge the move by
   * naming the inbox the channel is expected to be leaving, having authorized
   * that inbox themselves (`inbox.addIntegration` asserts manage access on it).
   *
   * Omit `repointFromInboxId`, or name an inbox the channel is no longer in,
   * and the re-point is refused. Re-checking inside the transaction is what
   * makes the caller's authorization hold: a concurrent re-route between the
   * caller's read and this write can no longer slip through unauthorized.
   */
  async addIntegration(
    recordId: RecordId,
    integrationId: string,
    isDefault: boolean = false,
    settings?: Record<string, unknown>,
    options: { repointFromInboxId?: string } = {}
  ) {
    const instanceId = getInstanceId(recordId)
    logger.info('Adding integration to inbox', { instanceId, integrationId, isDefault })

    const result = await this.db.transaction(async (tx) => {
      // Ownership first: every read and write below is keyed on this
      // integration, so an out-of-org id must be rejected before any of them.
      const integration = await tx.query.Integration.findFirst({
        where: and(
          eq(schema.Integration.id, integrationId),
          eq(schema.Integration.organizationId, this.organizationId)
        ),
      })

      if (!integration) {
        throw new NotFoundError(`Integration ${integrationId} not found`)
      }

      // Where the channel routes today, scoped to this org's inboxes — the
      // link row alone carries no organizationId, so it is joined through the
      // inbox EntityInstance rather than read on `integrationId` alone.
      const [existing] = await tx
        .select({
          id: schema.InboxIntegration.id,
          inboxId: schema.InboxIntegration.inboxId,
        })
        .from(schema.InboxIntegration)
        .innerJoin(
          schema.EntityInstance,
          eq(schema.EntityInstance.id, schema.InboxIntegration.inboxId)
        )
        .where(
          and(
            eq(schema.InboxIntegration.integrationId, integrationId),
            eq(schema.EntityInstance.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (
        existing &&
        existing.inboxId !== instanceId &&
        options.repointFromInboxId !== existing.inboxId
      ) {
        throw new ConflictError(
          'This channel is already routed to another inbox. Re-route it from that inbox instead.'
        )
      }

      // If this is the default integration, unset other defaults
      if (isDefault) {
        await tx
          .update(schema.InboxIntegration)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.InboxIntegration.inboxId, instanceId),
              eq(schema.InboxIntegration.isDefault, true)
            )
          )
      }

      if (existing) {
        // Update existing assignment
        const [updated] = await tx
          .update(schema.InboxIntegration)
          .set({ isDefault, inboxId: instanceId, settings: settings ?? {}, updatedAt: new Date() })
          .where(eq(schema.InboxIntegration.id, existing.id))
          .returning()
        return updated
      }

      // Create new assignment
      const [created] = await tx
        .insert(schema.InboxIntegration)
        .values({
          inboxId: instanceId,
          integrationId,
          isDefault,
          settings: settings ?? {},
          updatedAt: new Date(),
        })
        .returning()

      return created
    })

    await onCacheEvent('channel.inbox-link.changed', { orgId: this.organizationId })
    return result
  }

  /**
   * Add an integration to an inbox by raw ID (convenience method).
   *
   * Def-agnostic: {@link addIntegration} only ever reads the instance id out of
   * the RecordId, and every query it runs is keyed on `InboxIntegration.inboxId`
   * / `Integration.id`. The `'inbox'` prefix is inert here.
   */
  async addIntegrationById(
    inboxId: string,
    integrationId: string,
    isDefault: boolean = false,
    settings?: Record<string, unknown>
  ) {
    return this.addIntegration(toRecordId('inbox', inboxId), integrationId, isDefault, settings)
  }

  /**
   * Remove an integration from an inbox
   */
  async removeIntegration(recordId: RecordId, integrationId: string): Promise<boolean> {
    const instanceId = getInstanceId(recordId)
    logger.info('Removing integration from inbox', { instanceId, integrationId })

    await this.db
      .delete(schema.InboxIntegration)
      .where(
        and(
          eq(schema.InboxIntegration.inboxId, instanceId),
          eq(schema.InboxIntegration.integrationId, integrationId)
        )
      )

    await onCacheEvent('channel.inbox-link.changed', { orgId: this.organizationId })
    return true
  }

  /**
   * Get or create the canonical shared inbox for the organization.
   *
   * System-onboarding only: the sole remaining caller is
   * `ensureForwardingAddressIntegration` (the org's system-managed inbound
   * forwarding address, which has no user-facing connect step to pick a
   * destination). Interactive channel connects are inbox-first (channels v2) —
   * they carry a validated `pc_inboxId` and never fall back to a default inbox.
   */
  async getOrCreateSharedInbox(): Promise<Inbox> {
    const existingInboxes = await this.getInboxes()
    let sharedInbox =
      existingInboxes.find((i) => i.name === 'Shared Inbox') ??
      existingInboxes.find((i) => i.name === 'Default Inbox')

    if (!sharedInbox) {
      sharedInbox = await this.createInbox({
        name: 'Shared Inbox',
        description: 'Default inbox for all incoming emails',
        color: 'blue',
        status: 'ACTIVE',
      })
      return sharedInbox
    }

    if (sharedInbox.name === 'Default Inbox') {
      sharedInbox = await this.updateInbox(sharedInbox.recordId, {
        name: 'Shared Inbox',
        description: 'Default shared inbox for all incoming emails',
      })
    }

    return sharedInbox
  }

  /**
   * Add an integration to the canonical shared inbox.
   *
   * System-onboarding only (see {@link getOrCreateSharedInbox}). Interactive
   * channel connects are inbox-first — they validate + link a chosen inbox in
   * their provisioning hook and never route through here.
   */
  async addIntegrationToSharedInbox(
    integrationId: string,
    isDefault: boolean = true,
    settings?: Record<string, unknown>
  ) {
    const sharedInbox = await this.getOrCreateSharedInbox()
    return this.addIntegration(sharedInbox.recordId, integrationId, isDefault, settings)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Personal-account marker, DERIVED (plan 40 §3.4).
   *
   * `personal_inbox` def membership OR the legacy `inbox_is_personal`
   * FieldValue.
   *
   * **The marker half is KEPT through phase 4's field deletion**, deliberately.
   * Data migrations run asynchronously at WORKER BOOT
   * (`jobs/maintenance/data-migrations-job.ts`), never as a blocking pre-deploy
   * step, so this code serves requests while 060 (move the instances) and 062
   * (drop the fields) are still queued. For an org in that window every personal
   * mailbox is still on the SHARED def carrying the marker — def-only would
   * report `false`, `composeUserInstanceGrants` would skip its personal branch,
   * and the `Area.inboxes` fallback would hand every org member `full` on
   * someone's private mailbox. That is the exact regression this whole plan
   * exists to prevent, so the two lines stay.
   *
   * Deleting `INBOX_FIELDS.isPersonal` does NOT starve this read: the resource
   * registry merges DB `CustomField` rows with the static registry and RETURNS
   * UNMATCHED DB ROWS (`resource-registry-service.mergeSystemAndCustomFields` —
   * `[...unmatchedStaticFields, ...enrichedDbFields]`), so `fieldValues
   * .inbox_is_personal` keeps resolving until 062 deletes the row. Afterwards it
   * is `undefined`, the OR short-circuits on the def, and this costs nothing.
   */
  private static derivePersonal(defKey: InboxDef, marker: unknown): boolean {
    return defKey === 'personal_inbox' || marker === true
  }

  /**
   * Transform a listAll result item to Inbox type (no extra queries).
   *
   * `defKey` comes from the caller's def-scoped list, so it is the instance's
   * real definition. The RecordId is re-minted slug-keyed rather than reusing
   * `item.recordId` (which `listAll` builds from the def CUID) — mail
   * `ResourceAccess` rows live in the slug keyspace, so a CUID-keyed inbox
   * RecordId escaping into a grant is the 2026-07-29 bug shape.
   */
  private transformToInbox(
    item: {
      id: string
      recordId: RecordId
      fieldValues: Record<string, unknown>
      displayName?: string | null
      organizationId: string
      createdAt: Date
      updatedAt: Date
      createdById: string | null
    },
    defKey: InboxDef,
    floors: Record<string, Lens>
  ): Inbox {
    return {
      id: item.id,
      recordId: toRecordId(defKey, item.id),
      entityDefinitionKey: defKey,
      name: item.displayName ?? '',
      description: (item.fieldValues.inbox_description as string) ?? null,
      color: (item.fieldValues.inbox_color as string) ?? 'indigo',
      status: ((scalarFieldValue(item.fieldValues.inbox_status) as string) ??
        'ACTIVE') as Inbox['status'],
      defaultLens: InboxService.floorFor(defKey, item.id, floors),
      isPersonal: InboxService.derivePersonal(defKey, item.fieldValues.inbox_is_personal),
      ownerUserId: (item.fieldValues.inbox_owner_user_id as string) ?? null,
      settings: (item.fieldValues.inbox_settings as Record<string, unknown>) ?? {},
      organizationId: item.organizationId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdById: item.createdById,
    }
  }

  /**
   * Resolve EntityInstance + FieldValues to Inbox type.
   *
   * The instance is read FIRST so the RecordId can be canonicalized to the def
   * it actually lives on before any FieldValue read: `getFieldValues` resolves
   * CustomField ids through the RecordId's def, so a `inbox:<personal id>`
   * RecordId would return an EMPTY value map — an all-defaults inbox with
   * `isPersonal: false`, silently, with nothing thrown.
   */
  private async resolveInbox(recordId: RecordId): Promise<Inbox> {
    const instanceId = getInstanceId(recordId)

    const instance = await this.db.query.EntityInstance.findFirst({
      where: eq(schema.EntityInstance.id, instanceId),
    })

    if (!instance) {
      throw new Error(`Inbox not found: ${recordId}`)
    }

    const defKey = await this.defKeyForDefId(instance.entityDefinitionId)
    const canonicalRecordId = toRecordId(defKey, instanceId)
    const [values, floors] = await Promise.all([
      this.crudHandler.getFieldValues(canonicalRecordId),
      readInboxFloors(this.db, this.organizationId, [instanceId]),
    ])

    // Helper to get text value from field values map
    const getValue = (fieldId: string): unknown => {
      const entry = values.get(fieldId)
      return entry?.value ?? null
    }

    return {
      id: instance.id,
      recordId: canonicalRecordId,
      entityDefinitionKey: defKey,
      name: instance.displayName ?? '',
      description: (getValue('inbox_description') as string) ?? null,
      color: (getValue('inbox_color') as string) ?? 'indigo',
      status: ((scalarFieldValue(getValue('inbox_status')) as string) ??
        'ACTIVE') as Inbox['status'],
      defaultLens: InboxService.floorFor(defKey, instanceId, floors),
      isPersonal: InboxService.derivePersonal(defKey, getValue('inbox_is_personal')),
      ownerUserId: (getValue('inbox_owner_user_id') as string) ?? null,
      settings: (getValue('inbox_settings') as Record<string, unknown>) ?? {},
      organizationId: instance.organizationId,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
      createdById: instance.createdById,
    }
  }

  /**
   * Get inbox with integrations
   */
  async getInboxWithIntegrations(recordId: RecordId): Promise<InboxWithIntegrations | null> {
    const inbox = await this.getInbox(recordId)
    if (!inbox) return null

    const instanceId = getInstanceId(recordId)
    const integrations = await this.db.query.InboxIntegration.findMany({
      where: eq(schema.InboxIntegration.inboxId, instanceId),
      with: {
        integration: {
          columns: { id: true, name: true, email: true, provider: true },
        },
      },
    })

    return {
      ...inbox,
      integrations: integrations.map((i) => ({
        id: i.id,
        integrationId: i.integrationId,
        isDefault: i.isDefault,
        settings: i.settings as Record<string, unknown>,
        integration: i.integration,
      })),
    }
  }

  /**
   * Get inbox with integrations by raw ID (convenience method).
   *
   * Same def-prefix-as-hint contract as {@link getInboxById}; the integration
   * join is keyed on the instance id.
   */
  async getInboxWithIntegrationsById(inboxId: string): Promise<InboxWithIntegrations | null> {
    return this.getInboxWithIntegrations(toRecordId('inbox', inboxId))
  }
}
