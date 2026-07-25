// packages/lib/src/cache/providers/restricted-entity-def-ids-provider.ts

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { isCustomResourceId } from '../../resources/registry/types'
import type { CacheProvider } from '../org-cache-provider'

/**
 * The org-wide set of entity definitions that carry at least one **type-level**
 * `ResourceAccess` grant (`entityInstanceId IS NULL`), for ANY grantee.
 *
 * This is the "absent = unrestricted" signal for read-path enforcement
 * (capability layer v2 §0): a per-user `CapabilitySet.defAccess` map only holds
 * the defs *this* user was granted, so it cannot distinguish "restricted, and
 * I'm not a grantee" from "unrestricted." `canViewEntity` intersects this
 * org-wide restricted set with the per-user `defAccess` to decide visibility —
 * a def NOT in this set is visible to everyone.
 *
 * **Only `EntityDefinition.id` CUID-keyed rows count.** Slug-keyed type rows
 * (`'inbox'`, `'thread'`, `'sequence'`, `'snippet'`, …) are the pre-existing
 * SHARING grants — "give X access to all of def Y" for mail visibility and
 * sequence/snippet sharing — the OPPOSITE semantics of restriction, so they
 * must never mark a def as restricted. The def-restriction write path (Phase 3
 * Access UI) must therefore always write the EntityDefinition CUID.
 *
 * **The grantee-agnostic `selectDistinct` is load-bearing — do NOT add a grantee
 * filter here.** It is also the reason every *reader* must understand every
 * grantee kind (doc 19 §8.2 / 19a finding 1): because ANY row marks the def
 * restricted while `defAccess` only carries the kinds a reader can resolve, a
 * grantee kind that some resolver cannot read does not fail closed for that
 * grantee — it makes the def go dark **for every non-admin in the org**. That
 * asymmetry, not the write itself, is why profile-grantee `ResourceAccess`
 * writes were refused until all four resolvers learned the kind.
 *
 * Invalidated by the `resource-access.type.changed` cache event (fired on every
 * type-level grant/revoke).
 */
export const restrictedEntityDefIdsProvider: CacheProvider<string[]> = {
  async compute(orgId, db) {
    const rows = await db
      .selectDistinct({ entityDefinitionId: schema.ResourceAccess.entityDefinitionId })
      .from(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, orgId),
          isNull(schema.ResourceAccess.entityInstanceId)
        )
      )

    return rows.map((r) => r.entityDefinitionId).filter((id) => isCustomResourceId(id))
  },
}
