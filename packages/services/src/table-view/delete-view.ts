// packages/services/src/table-view/delete-view.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { CannotDeleteDefaultViewError } from './errors'
import { getView } from './get-view'

/**
 * Input for deleting a view
 */
export interface DeleteViewInput {
  id: string
  userId: string
  organizationId: string
}

/**
 * Delete a view (owner only, cannot delete default)
 */
export async function deleteView(input: DeleteViewInput) {
  const { id, userId, organizationId } = input

  // Verify ownership using getView
  const viewResult = await getView({
    id,
    userId,
    organizationId,
    options: { ownerOnly: true, notFoundMessage: "View not found or you don't have permission to delete it" },
  })

  if (viewResult.isErr()) return viewResult

  if (viewResult.value.isDefault) {
    return err<CannotDeleteDefaultViewError>({ code: 'CANNOT_DELETE_DEFAULT_VIEW', message: 'Cannot delete the default view', viewId: id })
  }

  const dbResult = await fromDatabase(database.delete(schema.TableView).where(eq(schema.TableView.id, id)), 'delete-view')
  if (dbResult.isErr()) return dbResult

  return ok({ success: true })
}
