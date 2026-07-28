// apps/web/src/server/lib/dataset-document-asset-access.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { NotFoundError } from '@auxx/lib/errors'
import type { CapabilitySet } from '@auxx/lib/permissions/capabilities/capability-set'
import { and, eq } from 'drizzle-orm'

/**
 * Authorize a read of the `MediaAsset` backing a dataset document.
 *
 * A dataset document's asset is DATASET content, so it authorizes against
 * `canViewInstance('dataset', …)` — the same predicate `document.getDownloadUrl`
 * already applies to the same bytes — and never against `Area.files`. Gating it
 * on `filesView` made dataset access non-self-sufficient: a member scoped to one
 * dataset with `files` below Read could download the document through
 * `document.getDownloadUrl` but got a blank preview pane, so the Files gate
 * enforced no boundary and only broke the UI.
 *
 * The `assetId` equality check is load-bearing. Without it the scope is a
 * confused deputy: a caller holding view on any one dataset could name a
 * document in that dataset while requesting an unrelated asset elsewhere in the
 * org, and inherit the dataset's authorization for it.
 *
 * Resolution order matches `datasetIdForDocument` in `routers/document.ts`: a
 * missing or foreign-org document 404s before any capability is read.
 */
export async function assertDatasetDocumentAssetAccess(
  db: Database,
  capabilities: CapabilitySet,
  params: { documentId: string; assetId: string; organizationId: string }
): Promise<void> {
  const { documentId, assetId, organizationId } = params

  const [row] = await db
    .select({
      datasetId: schema.Document.datasetId,
      mediaAssetId: schema.Document.mediaAssetId,
    })
    .from(schema.Document)
    .where(
      and(eq(schema.Document.id, documentId), eq(schema.Document.organizationId, organizationId))
    )
    .limit(1)

  if (!row) throw new NotFoundError('Document not found')

  capabilities.assertViewInstance('dataset', row.datasetId)

  if (!row.mediaAssetId || row.mediaAssetId !== assetId) {
    throw new NotFoundError('Document asset not found')
  }
}
