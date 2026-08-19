// packages/lib/src/ingest/contacts/repair-name.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { usableContactName } from '../../participants/client'
import { toRecordId } from '../../resources/resource-id'
import { getNamesFromParticipant } from '../participants/display'

const logger = createScopedLogger('contact-name-repair')

export interface RepairContactNameArgs {
  organizationId: string
  /**
   * The contact this participant is linked to (`Participant.entityInstanceId`).
   * `null` is the ordinary case for a counterpart no contact was minted for —
   * accepted here so callers do not each repeat the guard.
   */
  entityInstanceId: string | null
  /** The participant's raw identifier — what a laundered name looks like. */
  identifier: string
  /** The name that just became known. Must be a real name, never an identifier. */
  name: string
}

/**
 * Give a contact the name its participant just acquired, if it has none of its own.
 *
 * Contact creation and name resolution are two different events on two different
 * clocks. Ingest mints a contact the moment `selective` mode is satisfied — for a
 * Meta DM that is the first outbound reply — while the counterpart's real name only
 * arrives once `resolveSocialCounterpartName` has answered Graph. A contact minted
 * inside that window is named from a participant that had no name, and **nothing
 * afterwards ever revisits it**: name resolution writes `Participant`, not the
 * record. That is how a contact ends up permanently called `27893553143563440`.
 *
 * This closes the window from the other side. It is deliberately narrow:
 *
 * - **Upgrade-only, never a rename.** {@link usableContactName} is the same test the
 *   mail label resolver uses — a display value equal to the identifier is not a
 *   name. Anything that passes it is a real name (typed by a human, imported, or
 *   resolved earlier) and is left alone.
 * - **Writes through `UnifiedCrudHandler`.** `full_name` is a computed field over
 *   `first_name`/`last_name`, and `EntityInstance.displayName` is denormalized from
 *   it; a direct `FieldValue` write would leave the record displaying the old id.
 *   The handler also emits `record:updated`, which is what makes open mail lists
 *   flip from id to name without a refetch (the record lane, not the mail lane —
 *   see `useResourceSync`'s `patchParticipantsForContact`).
 * - **Never throws.** Every caller is a post-200 `after()` hook on a webhook. A
 *   failed repair costs a stale label, not a retried delivery.
 *
 * The handler and the system-user lookup are imported lazily for the reason
 * documented on `publishParticipantPatch`: `profile.ts` is a provider module on
 * the webhook path, and a static edge from it into `UnifiedCrudHandler` widens
 * the graph into the org-cache cycle and breaks `vi.mock` interception in lib
 * tests. Same precedent as `record-rules/actions.ts`.
 *
 * @returns `true` when the contact's name was written.
 */
export async function repairContactNameFromParticipant(
  db: Database,
  args: RepairContactNameArgs
): Promise<boolean> {
  const { organizationId, entityInstanceId, identifier, name } = args
  if (!entityInstanceId) return false

  try {
    const [instance] = await db
      .select({
        id: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
        entityDefinitionId: schema.EntityInstance.entityDefinitionId,
      })
      .from(schema.EntityInstance)
      .where(
        and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, organizationId),
          // A linked contact can be archived out from under the participant —
          // `entityInstanceId` is not cleared by archival. Repairing one would
          // resurrect it into every list that filters on `archivedAt IS NULL`.
          isNull(schema.EntityInstance.archivedAt)
        )
      )
      .limit(1)

    if (!instance) return false
    if (usableContactName(instance.displayName, identifier)) return false

    // Split through the same helper contact creation uses, with the name passed
    // as `name` so the identifier fallback cannot re-enter here.
    const names = getNamesFromParticipant({ name })
    if (!names.firstName) return false

    const [{ UnifiedCrudHandler }, { SystemUserService }] = await Promise.all([
      import('../../resources/crud/unified-handler'),
      import('../../users/system-user-service'),
    ])
    const systemUserId = await SystemUserService.getSystemUserForActions(organizationId)
    const handler = new UnifiedCrudHandler(organizationId, systemUserId, db)
    await handler.update(toRecordId(instance.entityDefinitionId, instance.id), {
      first_name: names.firstName,
      last_name: names.lastName ?? null,
    })

    logger.info('Repaired contact name from a resolved participant name', {
      organizationId,
      entityInstanceId,
    })
    return true
  } catch (error) {
    logger.warn('Contact name repair failed (ignored)', {
      organizationId,
      entityInstanceId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
