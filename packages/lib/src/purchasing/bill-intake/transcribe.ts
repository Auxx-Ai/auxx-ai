// packages/lib/src/purchasing/bill-intake/transcribe.ts

/**
 * Step 1 of the bill-intake pipeline (plans/money/tasks/58 §2.3): a thin
 * caller of `transcribeDocument`, the same one `transcribeQuote` calls. All
 * the document handling (asset load, format conversion, the multimodal
 * content build, the orchestrator invoke, the JSON extraction) lives there;
 * this file only supplies the invoice's spec.
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import {
  type TranscribeDocumentOutput,
  type TranscribeQuoteInput,
  transcribeDocument,
} from '../intake/transcribe'
import type { TranscribedInvoice } from './client'
import { INVOICE_TRANSCRIBE_SPEC } from './schema'

/**
 * Read one vendor invoice into {@link TranscribedInvoice}.
 *
 * @param userId The member whose upload this is, or `null` for a background run.
 *   Reaches credential resolution and the usage insert; never `''`.
 */
export async function transcribeInvoice(
  db: Database,
  organizationId: string,
  userId: string | null,
  input: TranscribeQuoteInput
): Promise<Result<TranscribeDocumentOutput<TranscribedInvoice>, Error>> {
  return transcribeDocument(db, organizationId, userId, input, INVOICE_TRANSCRIBE_SPEC)
}
