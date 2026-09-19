// packages/lib/src/accounting/documents/edit-in-place/open.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getCachedEntityDefId } from '../../../cache'
import {
  captureRecordSnapshot,
  type EditStamp,
  publishRecordEditStamp,
} from '../../../entity-instances/edit-snapshot'
import { BadRequestError } from '../../../errors'
import { type DocumentEditFamily, documentEditRow } from './spec'

const logger = createScopedLogger('accounting:document-edit')

export interface DocumentEditInput {
  organizationId: string
  family: DocumentEditFamily
  /** The header's `EntityInstance` id. */
  entityInstanceId: string
  userId: string
}

/**
 * Unlock a finalized document for editing: capture its snapshot and stamp it.
 *
 * The snapshot row IS the edit flag (74 D1), so nothing else is written. The
 * first Edit wins (66 D9) — a second returns the standing stamp.
 */
export async function openDocumentEdit(db: Database, input: DocumentEditInput): Promise<EditStamp> {
  const { organizationId, family, entityInstanceId, userId } = input
  const row = documentEditRow(family)
  const doc = await row.load(db, organizationId, entityInstanceId)

  if (row.editRefusedIn.includes(doc.status)) {
    throw new BadRequestError(row.refuseEdit(doc), {
      family,
      entityInstanceId,
      status: doc.status,
    })
  }

  const edit = await captureRecordSnapshot(db, {
    organizationId,
    entityInstanceId,
    children: row.children,
    byUserId: userId,
  })

  const entityDefinitionId = await getCachedEntityDefId(organizationId, family)
  if (entityDefinitionId) {
    await publishRecordEditStamp({ organizationId, entityDefinitionId, entityInstanceId, edit })
  }

  logger.info('Opened a document for editing', {
    organizationId,
    family,
    entityInstanceId,
    internalNumber: doc.internalNumber,
  })
  return edit
}
