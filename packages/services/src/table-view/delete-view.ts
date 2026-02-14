// packages/services/src/table-view/delete-view.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
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
 * Delete a view (owner only, any view including default can be deleted)
 */
export async function deleteView(input: DeleteViewInput) {
  const { id, userId, organizationId } = input

  // Verify ownership using getView
  const viewResult = await getView({
    id,
    userId,
    organizationId,
    options: {
      ownerOnly: true,
      notFoundMessage: "View not found or you don't have permission to delete it",
    },
  })

  if (viewResult.isErr()) return viewResult

  const dbResult = await fromDatabase(
    database.delete(schema.TableView).where(eq(schema.TableView.id, id)),
    'delete-view'
  )
  if (dbResult.isErr()) return dbResult

  return ok({ success: true })
}
