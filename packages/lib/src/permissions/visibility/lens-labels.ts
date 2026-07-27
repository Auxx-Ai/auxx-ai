// packages/lib/src/permissions/visibility/lens-labels.ts

import type { Lens } from './lens'

/**
 * User-facing language for the lens tiers (UI plan §"User-facing language").
 * The word "lens" never appears in UI; these labels are the single source the
 * FE renders from so copy and redaction stay in sync.
 *
 * `manager` is not a lens — it maps to `permission='admin'` on an inbox grant
 * (Full access + manage sharing), rendered as an entry in the same picker.
 */
export type LensChoice = Exclude<Lens, 'none'> | 'manager'

export interface LensLabel {
  label: string
  helper: string
}

export const LENS_LABELS: Record<Lens | 'manager', LensLabel> = {
  full: { label: 'Full access', helper: 'Read and reply to conversations' },
  subject: {
    label: 'Subject only',
    helper: 'See who, when, and subject lines, not message content',
  },
  metadata: { label: 'Activity only', helper: 'See who and when, not subjects or content' },
  none: { label: 'No access', helper: 'Hidden unless individually shared' },
  manager: { label: 'Manager', helper: 'Full access + manage sharing' },
}

/** The grantable tiers in the order pickers render them (widest first). */
export const LENS_CHOICES: readonly Exclude<Lens, 'none'>[] = ['full', 'subject', 'metadata']
