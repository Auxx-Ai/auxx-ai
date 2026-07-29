// packages/lib/src/email/labels/__tests__/label-sync.test.ts

import { describe, expect, it } from 'vitest'
import type { ProviderLabel } from '../label-provider.interface'
import { diffProviderLabels } from '../label-sync'
import type { LabelEntity } from '../types'

/**
 * Build a `Label` row. Defaults mirror the DB defaults (`isVisible: true`,
 * colors `NULL`) so a test only states the column it is exercising.
 */
function dbLabel({
  labelId,
  ...overrides
}: Partial<LabelEntity> & { labelId: string }): LabelEntity {
  return {
    id: `row-${labelId}`,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    integrationType: 'google',
    integrationId: 'int-1',
    labelId,
    name: labelId,
    description: null,
    enabled: true,
    isVisible: true,
    backgroundColor: null,
    textColor: null,
    type: 'user',
    organizationId: 'org-1',
    providerCursor: null,
    pendingAction: null,
    isSentBox: false,
    parentLabelId: null,
    syncCheckpoint: null,
    ...overrides,
  } as LabelEntity
}

/** Build a provider label. Colors/visibility left `undefined` like a real payload. */
function providerLabel({
  id,
  ...overrides
}: Partial<ProviderLabel> & { id: string }): ProviderLabel {
  return { id, name: id, ...overrides }
}

describe('diffProviderLabels', () => {
  it('creates a label that exists only in the provider', () => {
    const diff = diffProviderLabels(
      [providerLabel({ id: 'p1', name: 'Invoices', backgroundColor: '#fff', textColor: '#000' })],
      []
    )

    expect(diff.toUpdate).toEqual([])
    expect(diff.toDelete).toEqual([])
    expect(diff.toCreate).toEqual([
      {
        labelId: 'p1',
        name: 'Invoices',
        type: 'user',
        backgroundColor: '#fff',
        textColor: '#000',
        isVisible: true,
      },
    ])
  })

  it('deletes a label that exists only in the DB', () => {
    const diff = diffProviderLabels([], [dbLabel({ labelId: 'gone' })])

    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toDelete).toEqual(['row-gone'])
  })

  it('produces an empty diff when provider and DB agree', () => {
    // Regression guard: the provider reports absent colors as `undefined` while
    // the DB stores them as NULL, so without the `|| null` normalization every
    // uncolored label looks changed and every sync rewrites every row forever.
    const diff = diffProviderLabels(
      [providerLabel({ id: 'p1', name: 'Invoices' })],
      [dbLabel({ labelId: 'p1', name: 'Invoices' })]
    )

    expect(diff).toEqual({ toCreate: [], toUpdate: [], toDelete: [] })
  })

  it('updates only the row whose name changed', () => {
    const diff = diffProviderLabels(
      [
        providerLabel({ id: 'p1', name: 'Invoices renamed' }),
        providerLabel({ id: 'p2', name: 'Receipts' }),
      ],
      [dbLabel({ labelId: 'p1', name: 'Invoices' }), dbLabel({ labelId: 'p2', name: 'Receipts' })]
    )

    expect(diff.toCreate).toEqual([])
    expect(diff.toDelete).toEqual([])
    expect(diff.toUpdate).toEqual([
      {
        id: 'row-p1',
        name: 'Invoices renamed',
        backgroundColor: null,
        textColor: null,
        isVisible: true,
      },
    ])
  })

  it('updates a row whose colors changed', () => {
    const diff = diffProviderLabels(
      [providerLabel({ id: 'p1', backgroundColor: '#123456', textColor: '#abcdef' })],
      [dbLabel({ labelId: 'p1', backgroundColor: '#000000', textColor: '#ffffff' })]
    )

    expect(diff.toUpdate).toEqual([
      {
        id: 'row-p1',
        name: 'p1',
        backgroundColor: '#123456',
        textColor: '#abcdef',
        isVisible: true,
      },
    ])
  })

  it('updates a row whose visibility changed', () => {
    const diff = diffProviderLabels(
      [providerLabel({ id: 'p1', visible: false })],
      [dbLabel({ labelId: 'p1', isVisible: true })]
    )

    expect(diff.toUpdate).toEqual([
      { id: 'row-p1', name: 'p1', backgroundColor: null, textColor: null, isVisible: false },
    ])
  })

  it('defaults an undefined provider `visible` to true', () => {
    const diff = diffProviderLabels([providerLabel({ id: 'p1' })], [])

    expect(diff.toCreate[0]?.isVisible).toBe(true)
  })

  it("maps type 'system' to the system label type and everything else to user", () => {
    const diff = diffProviderLabels(
      [
        providerLabel({ id: 'sys', type: 'system' }),
        providerLabel({ id: 'usr', type: 'user' }),
        // A provider-specific string we don't recognise must not reach the pg enum.
        providerLabel({ id: 'weird', type: 'labelTypeWeDontKnow' }),
        providerLabel({ id: 'none' }),
      ],
      []
    )

    expect(diff.toCreate.map((row) => [row.labelId, row.type])).toEqual([
      ['sys', 'system'],
      ['usr', 'user'],
      ['weird', 'user'],
      ['none', 'user'],
    ])
  })
})
