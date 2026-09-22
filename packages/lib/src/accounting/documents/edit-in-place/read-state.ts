// packages/lib/src/accounting/documents/edit-in-place/read-state.ts

import type { Database } from '@auxx/database'
import { type EditStamp, readEditStamp } from '../../../entity-instances/edit-snapshot'
import { type DocumentLedgerState, readDocumentLedgerState } from '../document-ledger-state'

export interface DocumentEditState {
  /** `null` when the document is not open for editing. */
  edit: EditStamp | null
  ledger: DocumentLedgerState
}

/** Is this document unlocked, and where does its ledger generation stand? */
export async function readDocumentEditState(
  db: Database,
  input: { organizationId: string; entityInstanceId: string }
): Promise<DocumentEditState> {
  const { organizationId, entityInstanceId } = input
  const [edit, ledger] = await Promise.all([
    readEditStamp(db, organizationId, entityInstanceId),
    readDocumentLedgerState(db, organizationId, entityInstanceId),
  ])
  return { edit, ledger }
}
