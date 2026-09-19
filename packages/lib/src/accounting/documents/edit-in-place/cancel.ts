// packages/lib/src/accounting/documents/edit-in-place/cancel.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedEntityDefId } from '../../../cache'
import {
  publishRecordEditStamp,
  readEditStamp,
  restoreRecordSnapshot,
} from '../../../entity-instances/edit-snapshot'
import { ConflictError } from '../../../errors'
import type { DocumentEditInput } from './open'

const logger = createScopedLogger('accounting:document-edit')

export interface CancelDocumentEditResult {
  /** Always `null` — the document is locked again. The card stamps it on the record. */
  edit: null
}

/**
 * Throw the edit away: restore the snapshot through the ordinary write path and
 * drop the row (66 D5). The ledger was never touched, so there is nothing to
 * reverse.
 */
export async function cancelDocumentEdit(
  db: Database,
  input: DocumentEditInput
): Promise<CancelDocumentEditResult> {
  const { organizationId, family, entityInstanceId, userId } = input

  // The row is both the flag and the snapshot (74 D1), so "open with nothing to
  // restore" cannot occur; not open is the only refusal left.
  if (!(await readEditStamp(db, organizationId, entityInstanceId))) {
    throw new ConflictError(
      `This ${family.replace(/_/g, ' ')} is not open for editing, so there is nothing to cancel.`,
      { family, entityInstanceId }
    )
  }

  await restoreRecordSnapshot(db, { organizationId, entityInstanceId, actorUserId: userId })

  const entityDefinitionId = await getCachedEntityDefId(organizationId, family)
  if (entityDefinitionId) {
    await publishRecordEditStamp({
      organizationId,
      entityDefinitionId,
      entityInstanceId,
      edit: null,
    })
  }

  logger.info('Cancelled a document edit', { organizationId, family, entityInstanceId })
  return { edit: null }
}
