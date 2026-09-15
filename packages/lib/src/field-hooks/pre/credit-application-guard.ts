// packages/lib/src/field-hooks/pre/credit-application-guard.ts
import { ConflictError } from '../../errors'
import { isCreditApplicationWrite } from '../../money/credit-memos/write-scope'
import type { EntityPreCreateHandler, EntityPreDeleteHandler, FieldPreHookHandler } from '../types'

function requireCommand() {
  if (!isCreditApplicationWrite())
    throw new ConflictError('Use Apply credit or Undo application to change credit history')
}
/** Block generic creates that bypass credit capacity checks. */
export const guardCreditApplicationCreate: EntityPreCreateHandler = async () => {
  requireCommand()
}
/** Protect application amounts and relationships from direct field writes. */
export const guardCreditApplicationField: FieldPreHookHandler = async (event) => {
  requireCommand()
  return event.newValue
}
/** Application history is retained even after its credit has been restored. */
export const guardCreditApplicationDelete: EntityPreDeleteHandler = async () => {
  throw new ConflictError(
    'Credit application history cannot be deleted. Use Undo application instead'
  )
}
