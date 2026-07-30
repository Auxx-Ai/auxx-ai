// packages/lib/src/permissions/visibility/lens-labels.ts

import type { Rung } from '../capabilities/rung'
import type { Lens } from './lens'

/**
 * User-facing language for the lens tiers (UI plan §"User-facing language").
 * The word "lens" never appears in UI; these labels are the single source the
 * FE renders from so copy and redaction stay in sync.
 *
 * `manager` is not a lens — it maps to `rung='admin'` on an inbox grant
 * (Full access + manage sharing), rendered as an entry in the same picker.
 */
export type LensChoice = Exclude<Lens, 'none'> | 'manager'

export interface LensLabel {
  label: string
  helper: string
}

export const LENS_LABELS: Record<Lens | 'manager', LensLabel> = {
  read: { label: 'Full access', helper: 'Read and reply to conversations' },
  identity: {
    label: 'Subject only',
    helper: 'See who, when, and subject lines, not message content',
  },
  metadata: { label: 'Activity only', helper: 'See who and when, not subjects or content' },
  none: { label: 'No access', helper: 'Hidden unless individually shared' },
  manager: { label: 'Manager', helper: 'Full access + manage sharing' },
}

/** The grantable tiers in the order pickers render them (widest first). */
export const LENS_CHOICES: readonly Exclude<Lens, 'none'>[] = ['read', 'identity', 'metadata']

/**
 * Domain-NEUTRAL copy for the full {@link Rung} ladder, for surfaces that render
 * rows from more than one domain and therefore cannot use a domain's own words.
 *
 * The only such surface today is the Approvals tab's access-request row, which
 * lists thread requests (`read`) beside record requests (`read` or `edit`). It
 * used to read {@link LENS_LABELS}, which stops at `read` — so an `edit` request
 * resolved `undefined` and fell through to the "Full access" default, silently
 * mislabelling the widest ask in the system as the narrower one.
 *
 * ⚠ **This is deliberately NOT a superset of {@link LENS_LABELS}, and the two
 * disagree on `read` on purpose.** Mail's `read` IS mail's top tier, so calling
 * it "Full access" is right *there*; a record's `read` is the bottom of a ladder
 * that continues through `edit` and `admin`, so the same words would be a lie.
 * Keep domain pickers on their domain's labels — this is for shared chrome only,
 * and it is not the `RungSelect` convergence (HANDOFF §5), which stays undone.
 *
 * Total over `Rung` so a lookup needs no fallback: an unhandled rung is a
 * compile error rather than a wrong string at runtime.
 */
export const RUNG_LABELS: Record<Rung, string> = {
  none: 'No access',
  metadata: 'Activity only',
  identity: 'Subject only',
  read: 'Read access',
  edit: 'Edit access',
  admin: 'Full access',
}
