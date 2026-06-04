// packages/lib/src/ai/kopilot/digests.ts

import { z } from 'zod'

/**
 * Shared helpers for kopilot tool digests. A digest is the small projection of a
 * tool's output (built by each tool's `buildDigest`) that the frontend renders as
 * status pills and approval/result cards. The full output shape is each tool's
 * `outputSchema` (the single source of truth); this module holds only the bits
 * shared across tools.
 */

const DIGEST_SAMPLE_MAX = 3

/**
 * Shared draft shape — `list_drafts` uses it for both its `outputSchema` items
 * and its digest sample.
 */
export const DraftDigestSnapshot = z.object({
  id: z.string(),
  kind: z.enum(['reply', 'standalone']),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  recipientSummary: z.string().nullable(),
  updatedAt: z.string(),
  scheduledAt: z.string().nullable(),
  threadId: z.string().nullable().optional(),
})
export type DraftDigestSnapshot = z.infer<typeof DraftDigestSnapshot>

/**
 * Cap a list to its first `n` items (default 3) for a digest sample, so digests
 * stay small in storage. Tolerates a non-array / undefined input.
 */
export function takeSample<T>(items: readonly T[] | undefined, n = DIGEST_SAMPLE_MAX): T[] {
  if (!items || !Array.isArray(items)) return []
  return items.slice(0, n)
}
