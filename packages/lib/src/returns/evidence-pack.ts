// packages/lib/src/returns/evidence-pack.ts

/**
 * Generate the chargeback evidence pack for one return
 * (plans/money/tasks/54-returns.md section 7).
 *
 * One action. It assembles the six sections, renders them, and stores the PDF
 * through `ensureDocumentPdf` into `return_evidence_pack_asset`.
 *
 * 🛑 **This is the ONLY writer of that field.** `return_evidence_pack_asset` is
 * `creatable: false, updatable: false` for the same reason
 * `credit_memo_pdf_asset` is: `ensureDocumentPdf` reads the pointer, loads that
 * `MediaAsset` and appends a new VERSION whenever the content hash disagrees. A
 * file a person uploaded carries no `contentHash` at all, so the comparison
 * would fail on every call and the next generation would silently republish
 * their file as our pack. Do not open a human door to this field.
 *
 * 🔑 **Re-running is cheap and safe.** The content hash covers the whole
 * payload including the resolved document settings, so an unchanged return is a
 * pure cache hit - no render, no upload, no new version - and a changed one
 * appends a version to the SAME asset rather than minting a second. A pack
 * already submitted to a card network therefore stays reachable at the version
 * that was submitted.
 *
 * No permission checks: the router asserts (`docs/lib-module-guide.md`
 * section 6).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { ensureDocumentPdf } from '../documents/ensure-pdf'
import { NotFoundError } from '../errors'
import { guard } from './guard'
import { getReturn } from './reads'

/** The document-type id the pack is registered under (`documents/client.ts`). */
export const RETURN_EVIDENCE_PACK_DOCUMENT_TYPE = 'return_evidence_pack' as const

/** What {@link generateReturnEvidencePack} hands back. */
export interface ReturnEvidencePackResult {
  /** The `MediaAsset` the pointer field now names. Stable across regenerations. */
  assetId: string
  /** `RMA-0001.pdf`. */
  fileName: string
  /** `false` on a content-hash cache hit - nothing was rendered or uploaded. */
  rendered: boolean
}

/**
 * Render (or reuse) the evidence pack for one return and point
 * `return_evidence_pack_asset` at it.
 *
 * Refuses only for a return that does not exist in this organization. It does
 * NOT refuse a return with no order, no contact and no ticket: that is the 15
 * percent dock case (section 3.2) and the pack it produces is a document that
 * says what is known and what is not, which is exactly what that return needs
 * when the chargeback lands.
 */
export async function generateReturnEvidencePack(
  db: Database,
  organizationId: string,
  returnId: string,
  actorId: string
): Promise<Result<ReturnEvidencePackResult, Error>> {
  return guard(
    async () => {
      // Read first so a bad id is a 404 with a sentence, rather than whatever
      // the payload builder happens to throw three layers down.
      const returnResult = await getReturn(db, organizationId, returnId)
      if (returnResult.isErr()) throw returnResult.error
      const returnRecord = returnResult.value
      if (!returnRecord) {
        throw new NotFoundError('That return does not exist in this organization')
      }

      const result = await ensureDocumentPdf({
        documentType: RETURN_EVIDENCE_PACK_DOCUMENT_TYPE,
        organizationId,
        recordId: returnRecord.recordId,
        actorId,
      })

      return {
        assetId: result.assetId,
        fileName: result.fileName,
        rendered: result.rendered,
      }
    },
    'Failed to generate a return evidence pack',
    { organizationId, returnId }
  )
}
