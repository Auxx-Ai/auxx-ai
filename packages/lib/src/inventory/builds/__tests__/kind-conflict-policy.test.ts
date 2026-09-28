// packages/lib/src/inventory/builds/__tests__/kind-conflict-policy.test.ts

import { describe, expect, it } from 'vitest'
import { kindConflictFor, suggestedKindFor } from '../kind-conflict-policy'

const base = { isSubpartOfAssembly: false, hasBom: false, confirmed: false }

describe('kindConflictFor', () => {
  it('flags a finished good used inside another part', () => {
    expect(kindConflictFor({ ...base, kind: 'finished_good', isSubpartOfAssembly: true })).toBe(
      'finished_good_in_bom'
    )
  })

  it('flags a component with its own BOM, and an unset kind reads as component', () => {
    expect(kindConflictFor({ ...base, kind: 'component', hasBom: true })).toBe('component_with_bom')
    expect(kindConflictFor({ ...base, kind: null, hasBom: true })).toBe('component_with_bom')
  })

  it('leaves agreeing kinds alone', () => {
    expect(kindConflictFor({ ...base, kind: 'finished_good', hasBom: true })).toBeNull()
    expect(kindConflictFor({ ...base, kind: 'component', isSubpartOfAssembly: true })).toBeNull()
    expect(
      kindConflictFor({ ...base, kind: 'subassembly', isSubpartOfAssembly: true, hasBom: true })
    ).toBeNull()
  })

  it('never flags a service or a confirmed part', () => {
    expect(
      kindConflictFor({ ...base, kind: 'service', isSubpartOfAssembly: true, hasBom: true })
    ).toBeNull()
    expect(
      kindConflictFor({
        ...base,
        kind: 'finished_good',
        isSubpartOfAssembly: true,
        confirmed: true,
      })
    ).toBeNull()
  })
})

describe('suggestedKindFor', () => {
  it('suggests component for a finished good inside a BOM', () => {
    expect(
      suggestedKindFor({ reason: 'finished_good_in_bom', isSubpartOfAssembly: true, hasBom: false })
    ).toBe('component')
  })

  it('suggests finished good for a top-level component with a BOM', () => {
    expect(
      suggestedKindFor({ reason: 'component_with_bom', isSubpartOfAssembly: false, hasBom: true })
    ).toBe('finished_good')
  })

  it('suggests subassembly for a part both inside a BOM and with its own', () => {
    expect(
      suggestedKindFor({ reason: 'component_with_bom', isSubpartOfAssembly: true, hasBom: true })
    ).toBe('subassembly')
    expect(
      suggestedKindFor({ reason: 'finished_good_in_bom', isSubpartOfAssembly: true, hasBom: true })
    ).toBe('subassembly')
  })
})
