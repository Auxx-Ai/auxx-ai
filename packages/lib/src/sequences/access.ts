// packages/lib/src/sequences/access.ts
// ResourceAccess integration for sequences (Sequences plan §10 — all members
// can create; per-sequence view/edit/admin grants; creator gets admin). Uses
// the generic `entityDefinitionId: 'sequence'` bucket the same way
// `groups/permission-functions.ts` uses `'entity_group'` — sequences aren't a
// real `EntityDefinition` row, `ResourceAccess` just needs a stable string key.

import type { Database } from '@auxx/database'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { toRecordId } from '@auxx/types/resource'
import { grantInstanceAccess, hasPermission } from '../resource-access'

const SEQUENCE_ENTITY_DEFINITION_ID = 'sequence'

/** Minimal context shared by the access helpers below. */
export interface SequenceAccessContext {
  db: Database
  organizationId: string
}

/**
 * Grant the creating user `admin` access on a newly created sequence. Called
 * once from `createSequence` right after the `Sequence` row is inserted.
 */
export async function grantSequenceCreatorAccess(
  ctx: SequenceAccessContext & { userId: string },
  sequenceId: string
): Promise<void> {
  await grantInstanceAccess(
    { db: ctx.db, organizationId: ctx.organizationId, userId: ctx.userId },
    {
      recordId: toRecordId(SEQUENCE_ENTITY_DEFINITION_ID, sequenceId),
      granteeType: ResourceGranteeType.user,
      granteeId: ctx.userId,
      permission: ResourcePermission.admin,
    }
  )
}

/**
 * Check whether `userId` has at least `required` permission on a sequence.
 * A thin, sequence-scoped wrapper for the tRPC router — all of the logic is in
 * `hasPermission`/`checkAccess`.
 *
 * Only the org **OWNER** short-circuits to `admin` in there (doc 19 §0.10
 * recovery guarantee). ADMIN used to as well; step 10 removed it, so an admin
 * now needs a real grant like anyone else — the creator grant
 * {@link grantSequenceCreatorAccess} writes, a group/user share, or a
 * `granteeType:'profile'` grant naming the org's `admin` profile.
 *
 * **Note for the seeded client-notification templates:** they are created with
 * `createdById = <system user>`, so the creator grant lands on the system user
 * and no human holds anything on them. Until an org authors a profile grant on
 * the `'sequence'` type, only the OWNER can open them.
 */
export async function checkSequenceAccess(
  ctx: SequenceAccessContext,
  sequenceId: string,
  userId: string,
  required: ResourcePermission
): Promise<boolean> {
  return hasPermission(
    { db: ctx.db, organizationId: ctx.organizationId, userId },
    toRecordId(SEQUENCE_ENTITY_DEFINITION_ID, sequenceId),
    required
  )
}
