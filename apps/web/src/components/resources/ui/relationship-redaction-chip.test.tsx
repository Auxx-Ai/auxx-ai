// apps/web/src/components/resources/ui/relationship-redaction-chip.test.tsx

import { formatToRawValue, getRelationshipRedactedCount } from '@auxx/lib/field-values/client'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderCellValue } from '~/components/dynamic-table/utils/cell-renderers'
import { RestrictedRelationshipChip } from './restricted-relationship-chip'

// `RecordBadge` reaches the record store + tRPC and never settles under jsdom;
// stub the barrel the cell renderer imports from so hop 4 is about WHICH item the
// renderer chose, not hydration. `RestrictedRelationshipChip` stays REAL — it is
// the thing under test — and hop 3 imports it directly, off this mock's path.
vi.mock('~/components/resources/ui', async () => {
  const real = await import('./restricted-relationship-chip')
  return {
    RestrictedRelationshipChip: real.RestrictedRelationshipChip,
    RecordBadge: ({ recordId }: { recordId: string | null }) => <span>badge:{recordId}</span>,
    ActorBadge: () => null,
  }
})

/**
 * Plan v3/03 §5.4 — the redaction chain end to end, now that it can actually fire.
 *
 * `UnifiedCrudHandler` never forwarded capabilities to its `FieldValueService`, so
 * `redactedCount` was 0 on every record read the app ever performed and this whole
 * chain — `TypedFieldValue.redactedCount` → the relationship converter's
 * `toRawValue` marker → `getRelationshipRedactedCount` → the `__redacted__` cell
 * item → `RestrictedRelationshipChip` — had literally never rendered in
 * production. Threading the capabilities turns it on, which makes it unproven code
 * on a user-visible path: a relationship pointing at a def the member cannot view
 * now renders "N restricted" instead of the record name.
 *
 * Each hop is asserted separately, because the marker is deliberately shaped to
 * survive a lossy conversion (empty `recordId`, count-only) and a single
 * end-to-end assert would not say which hop dropped it.
 */

/** The server-side marker `batchGetAllDirectFieldValues` appends, verbatim. */
const MARKER = {
  id: 'fv_1:redacted',
  entityId: 'rec_1',
  fieldId: 'fld_1',
  sortKey: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  type: 'relationship' as const,
  recordId: '' as never,
  redactedCount: 2,
}

const REAL = {
  id: 'fv_2',
  entityId: 'rec_1',
  fieldId: 'fld_1',
  sortKey: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  type: 'relationship' as const,
  recordId: 'edf_deals:rec_9' as never,
  displayName: 'Acme deal',
}

describe('hop 1 — the marker survives the value→raw conversion', () => {
  it('formatToRawValue keeps the count and the real recordId side by side', () => {
    const raw = formatToRawValue([REAL, MARKER] as never, 'RELATIONSHIP' as never)
    expect(raw).toEqual(['edf_deals:rec_9', { redactedCount: 2 }])
  })

  it('a value with nothing redacted carries no marker', () => {
    expect(formatToRawValue([REAL] as never, 'RELATIONSHIP' as never)).toEqual(['edf_deals:rec_9'])
  })
})

describe('hop 2 — getRelationshipRedactedCount reads both shapes', () => {
  it('reads the count off the TABLE shape (post formatToRawValue)', () => {
    expect(getRelationshipRedactedCount(['edf_deals:rec_9', { redactedCount: 2 }])).toBe(2)
  })

  it('reads the count off the DETAIL shape (raw TypedFieldValue[])', () => {
    expect(getRelationshipRedactedCount([REAL, MARKER])).toBe(2)
  })

  it('is 0 when nothing was redacted — the overwhelmingly common case', () => {
    expect(getRelationshipRedactedCount(['edf_deals:rec_9'])).toBe(0)
    expect(getRelationshipRedactedCount([REAL])).toBe(0)
    expect(getRelationshipRedactedCount(null)).toBe(0)
  })
})

describe('hop 3 — the chip renders', () => {
  it('shows "N restricted" with a matching accessible label', () => {
    render(<RestrictedRelationshipChip count={2} />)
    expect(screen.getByText('2 restricted')).toBeInTheDocument()
    expect(screen.getByLabelText('2 restricted')).toBeInTheDocument()
  })

  it('is inert — no link, no button, nothing to click through to', () => {
    // Deliberately distinct from `RecordBadge`'s "Unknown" (deleted/not-found):
    // this is `no access`, and there is nothing the member may open.
    const { container } = render(<RestrictedRelationshipChip count={5} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(
      container.querySelector('[data-slot="restricted-relationship-chip"]')
    ).toBeInTheDocument()
  })
})

describe('hop 4 — the table cell renderer emits the chip for a redacted value', () => {
  it('renders one chip alongside the visible record badges', () => {
    render(<>{renderCellValue(['edf_deals:rec_9', { redactedCount: 3 }], 'RELATIONSHIP')}</>)
    expect(screen.getByText('badge:edf_deals:rec_9')).toBeInTheDocument()
    expect(screen.getByText('3 restricted')).toBeInTheDocument()
  })

  it('renders NO chip when nothing was redacted', () => {
    render(<>{renderCellValue(['edf_deals:rec_9'], 'RELATIONSHIP')}</>)
    expect(screen.getByText('badge:edf_deals:rec_9')).toBeInTheDocument()
    expect(screen.queryByText(/restricted/)).toBeNull()
  })
})
