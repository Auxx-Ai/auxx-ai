// apps/web/src/components/data-connectors/ui/mapping-connector.test.ts
import { describe, expect, it } from 'vitest'
import type { DraftMapping } from '../stores/connector-draft-store'
import { isAppOwnedManaged } from './mapping-connector-context'

/** Minimal mapping shape the predicate reads. */
const mapping = (
  over: Partial<Pick<DraftMapping, 'targetMode'>>
): Pick<DraftMapping, 'targetMode'> => ({
  targetMode: 'owned',
  ...over,
})

describe('isAppOwnedManaged', () => {
  it('is true for an app connector OWNED mapping (record id is connector-declared)', () => {
    expect(isAppOwnedManaged(true, mapping({ targetMode: 'owned' }))).toBe(true)
  })

  it('is true for a nested owned mapping (line items own their own id too)', () => {
    // No longer root-gated — any owned app mapping, at any depth, is managed.
    expect(isAppOwnedManaged(true, mapping({ targetMode: 'owned' }))).toBe(true)
  })

  it('is false for a contributing app mapping (customer → contact — Phase 2/v7)', () => {
    expect(isAppOwnedManaged(true, mapping({ targetMode: 'contributing' }))).toBe(false)
  })

  it('is false for a manual/generic-REST connector', () => {
    expect(isAppOwnedManaged(false, mapping({ targetMode: 'owned' }))).toBe(false)
  })
})
