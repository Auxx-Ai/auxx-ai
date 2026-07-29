// apps/web/src/server/lib/signature-instance-access.ts

import { type Database, schema } from '@auxx/database'
import { findCachedResource } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
import {
  type PrivateInstanceListScope,
  privateInstanceListScope,
  toResolvedRecordAccess,
} from '@auxx/lib/permissions/capabilities/entity-access'
import { getCapabilities } from '@auxx/lib/permissions/capabilities/get-capabilities'
import { and, eq } from 'drizzle-orm'

/**
 * The one authority for per-signature instance access (plan 36 §5).
 *
 * Every signature gate in the tree goes through this module so the read filter
 * and the write asserts can never disagree — the failure mode #1345 and #1359
 * both hit is a list that shows an instance the detail route then 403s on (or,
 * worse, the reverse). `signature.ts` applies {@link signatureListScope} in SQL
 * on `list` and calls {@link assertSignatureAccess} on every id-bearing
 * procedure; the non-router user-initiated consumers (`thread.sendMessage`,
 * `draft.upsert`, `sequence.update`) call it too.
 *
 * **Resolution before the assert is load-bearing here, unlike snippets.**
 * `governingInstanceIds` / `instanceAccess` are org-wide across ALL
 * instance-access resources and keyed by a globally-unique cuid2, so
 * `assertEditInstance('signature', <a dashboard id I own>)` would PASS on the
 * dashboard's row and then let the caller mutate a non-signature
 * `EntityInstance` through the signature router. {@link resolveSignatureId}
 * pins the id to a live `signature` instance in the caller's org first, so the
 * row that answers the assert always describes the thing being touched.
 *
 * **Not found is a 404 BEFORE the capability check, deliberately** — the
 * `agent-instance-access.ts` shape. A foreign-org id, a deleted id, and an id
 * of some other type all end as `NotFoundError`; only a resolvable in-org
 * signature ever reaches the capability check, so a 403 means exactly "this
 * signature exists and is not shared with you" and nothing weaker.
 *
 * Deep imports rather than the `@auxx/lib/permissions` barrel: the barrel hangs
 * under vitest (HANDOFF standing gotcha), and router tests import this module
 * transitively.
 */

/** The `INSTANCE_ACCESS_RESOURCES` key signatures are registered under. */
export const SIGNATURE_INSTANCE_KEY = 'signature' as const

/**
 * The rung a signature procedure needs.
 *  - `view`  — read it, stamp it on a draft/send, pick it in the composer.
 *  - `edit`  — change its name or body.
 *  - `admin` — delete it, or change who it is shared with.
 */
export type SignatureAccessTier = 'view' | 'edit' | 'admin'

/**
 * The org's `signature` `EntityDefinition.id`, or a 404 when the org has not
 * been seeded with the def. Reads the org `resources` cache — no DB roundtrip.
 */
export async function resolveSignatureDefinitionId(organizationId: string): Promise<string> {
  const resource = await findCachedResource(organizationId, SIGNATURE_INSTANCE_KEY)
  if (!resource) throw new NotFoundError('Signature not found')
  return resource.entityDefinitionId
}

/**
 * `id` → a live `signature` `EntityInstance.id` in `organizationId`, or a 404.
 *
 * Exported for the rare caller that needs the existence check without an assert.
 * Prefer {@link assertSignatureAccess} — a bare resolve is a lookup, not a
 * permission check.
 */
export async function resolveSignatureId(
  db: Database,
  organizationId: string,
  id: string
): Promise<string> {
  const entityDefinitionId = await resolveSignatureDefinitionId(organizationId)
  const [row] = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.id, id),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId)
      )
    )
    .limit(1)
  if (!row) throw new NotFoundError('Signature not found')
  return row.id
}

/**
 * Resolve `id` to a real signature in the org, then assert `tier` against it.
 * Returns the resolved id so callers can use it downstream instead of
 * re-resolving.
 *
 * @throws NotFoundError when no signature in the org matches the id.
 * @throws ForbiddenError (from the CapabilitySet) when the tier is not met.
 */
export async function assertSignatureAccess(params: {
  db: Database
  capabilities: CapabilitySet
  organizationId: string
  signatureId: string
  tier: SignatureAccessTier
}): Promise<string> {
  const { db, capabilities, organizationId, signatureId, tier } = params
  const id = await resolveSignatureId(db, organizationId, signatureId)

  if (tier === 'view') capabilities.assertViewInstance(SIGNATURE_INSTANCE_KEY, id)
  else if (tier === 'edit') capabilities.assertEditInstance(SIGNATURE_INSTANCE_KEY, id)
  else capabilities.assertAdminInstance(SIGNATURE_INSTANCE_KEY, id)

  return id
}

/**
 * The gate for a USER-INITIATED consumer that merely *uses* a signature id —
 * `thread.sendMessage`, `draft.upsert`, `sequence.update`. `view` is the tier:
 * stamping a signature on your own outgoing mail is reading it, not editing it.
 *
 * These are the sweep's real finds, and they are why gating only the signature
 * router would have left the hole open. `MessageComposerService.appendSignature`
 * — the ONLY code that reads signature bodies — is scoped by `EntityInstance.id`
 * + `organizationId` and nothing else, so before this any member could read the
 * rendered HTML of any other member's private signature simply by passing its id
 * to `thread.sendMessage`.
 *
 * **The gate belongs here, at the request edge, and NOT inside
 * `appendSignature`.** That function is shared with the headless senders (the
 * `sequence-send-email` node, automated sends), which run as the system, read no
 * member capabilities, and must keep stamping a restricted signature — the
 * documented carve-out `workflow` and `agent` already carry
 * (`instance-access.ts`). Pushing the check down would break the carve-out;
 * fetching capabilities in these procedures preserves it exactly.
 *
 * A `null`/`undefined` id is a no-op ("no signature"), not a denial.
 * These procedures are `protectedProcedure`, not `capabilityProcedure`, so the
 * `CapabilitySet` is fetched here rather than read off `ctx`.
 */
export async function assertSignatureUsable(params: {
  db: Database
  organizationId: string
  userId: string
  signatureId: string | null | undefined
}): Promise<void> {
  const { db, organizationId, userId, signatureId } = params
  if (!signatureId) return
  const capabilities = await getCapabilities(userId, organizationId)
  await assertSignatureAccess({
    db,
    capabilities,
    organizationId,
    signatureId,
    tier: 'view',
  })
}

/**
 * The id filter for a signature LIST query — the list-side twin of
 * {@link assertSignatureAccess} at the `view` tier, computed up front so it is
 * applied BEFORE any pagination or aggregation rather than by dropping rows
 * afterwards.
 *
 * `CapabilitySet.instanceListScope` is a **compile error** for `signature` by
 * design: it is typed to `OrgSharedInstanceAccessKey`, and its `'exclude'` arm
 * is only sound when a row-less instance is visible — the exact thing
 * `baselineAtCreate: true` denies. This routes to the private-resource twin
 * instead, through the same serialized capability view the client resolver
 * uses, so server enforcement and client affordances read one implementation.
 */
export function signatureListScope(capabilities: CapabilitySet): PrivateInstanceListScope {
  return privateInstanceListScope(
    toResolvedRecordAccess(capabilities.toClientCapabilities()),
    SIGNATURE_INSTANCE_KEY
  )
}
