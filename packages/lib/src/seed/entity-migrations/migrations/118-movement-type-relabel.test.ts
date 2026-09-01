// packages/lib/src/seed/entity-migrations/migrations/118-movement-type-relabel.test.ts
//
// Migration 118 is a pure label UPDATE inside a JSONB blob, so what can silently
// go wrong is never the write:
//
//  - the label lives in TWO places — `StockMovementType.values` (fresh orgs, and
//    every surface that reads the registry) and each org's own
//    `CustomField.options` JSONB (this migration) — and if they diverge, which
//    label a user sees depends on which screen they are on;
//  - `FieldValue.optionId` stores the `value` key, so rewriting one here would
//    orphan every stored movement type in the org;
//  - and the guard has to leave an org's own wording alone.
//
// These pin all three, plus the rule that the two build labels move together.

import { describe, expect, it } from 'vitest'
import { StockMovementType } from '../../../resources/registry/enum-values'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import {
  MOVEMENT_TYPE_RELABELS,
  migration118MovementTypeRelabel,
  relabelOptions,
  resolveLabel,
} from './118-movement-type-relabel'

describe('migration 118 registration', () => {
  it('is registered exactly once, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '118-movement-type-relabel')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(migration118MovementTypeRelabel.id).toBe('118-movement-type-relabel')
  })

  // The two migration directories share ONE id space, so a number free in one
  // can still be taken in the other.
  it('does not reuse an id already spent in the shared space', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id.startsWith('118-'))).toEqual(['118-movement-type-relabel'])
  })
})

describe('the registry agrees with the migration', () => {
  // 🛑 The registry reaches fresh orgs and this spec reaches existing ones.
  // Changing one without the other is exactly the half-migration that splits a
  // label by surface: `part-inventory-card.tsx` reads `StockMovementType.values`
  // while the records view reads the stored JSONB.
  it('every relabel names the value the registry already carries', () => {
    for (const spec of MOVEMENT_TYPE_RELABELS) {
      const option = StockMovementType.values.find((value) => value.value === spec.value)
      expect(option, `${spec.value} is not a StockMovementType`).toBeDefined()
      expect(option?.label).toBe(spec.next)
    }
  })

  it('covers BOTH build movement types', () => {
    expect(MOVEMENT_TYPE_RELABELS.map((spec) => spec.value).sort()).toEqual([
      'build_consume',
      'build_produce',
    ])
  })
})

describe('resolveLabel', () => {
  const spec = { old: 'Build (produce)', next: 'Produced' }

  it('updates the exact seeded label', () => {
    expect(resolveLabel('Build (produce)', spec)).toBe('update')
  })

  it('reports the new label as already done', () => {
    expect(resolveLabel('Produced', spec)).toBe('up-to-date')
  })

  // The org renamed it themselves and owns that string.
  it('skips anything else', () => {
    expect(resolveLabel('Made', spec)).toBe('skip')
    expect(resolveLabel('', spec)).toBe('skip')
  })
})

describe('relabelOptions', () => {
  const seeded = [
    { value: 'receive', label: 'Receive', color: 'green' },
    { value: 'adjust', label: 'Adjust', color: 'yellow' },
    { value: 'build_consume', label: 'Build (consume)', color: 'orange' },
    { value: 'build_produce', label: 'Build (produce)', color: 'teal' },
  ]

  it('rewrites both build labels and nothing else', () => {
    const next = relabelOptions(seeded, MOVEMENT_TYPE_RELABELS)
    expect(next).not.toBeNull()
    expect(next?.map((option) => option.label)).toEqual([
      'Receive',
      'Adjust',
      'Consumed',
      'Produced',
    ])
  })

  // 🛑 `FieldValue.optionId` stores the `value`. Touching one would orphan every
  // movement of that type, on `updatable: false` rows nothing can restate.
  it('preserves every value, colour and position', () => {
    const next = relabelOptions(seeded, MOVEMENT_TYPE_RELABELS)!
    expect(next.map((option) => option.value)).toEqual(seeded.map((option) => option.value))
    expect(next.map((option) => option.color)).toEqual(seeded.map((option) => option.color))
  })

  it('is a no-op on a second run', () => {
    const once = relabelOptions(seeded, MOVEMENT_TYPE_RELABELS)!
    expect(relabelOptions(once, MOVEMENT_TYPE_RELABELS)).toBeNull()
  })

  it('leaves an org that renamed the options alone', () => {
    const customized = [
      { value: 'build_consume', label: 'Issued to job', color: 'orange' },
      { value: 'build_produce', label: 'Completed to stock', color: 'teal' },
    ]
    expect(relabelOptions(customized, MOVEMENT_TYPE_RELABELS)).toBeNull()
  })

  it('relabels the half that is still seeded when the other was customized', () => {
    const mixed = [
      { value: 'build_consume', label: 'Issued to job', color: 'orange' },
      { value: 'build_produce', label: 'Build (produce)', color: 'teal' },
    ]
    const next = relabelOptions(mixed, MOVEMENT_TYPE_RELABELS)!
    expect(next.map((option) => option.label)).toEqual(['Issued to job', 'Produced'])
  })

  it('ignores an option list that carries neither value', () => {
    expect(
      relabelOptions([{ value: 'receive', label: 'Receive' }], MOVEMENT_TYPE_RELABELS)
    ).toBeNull()
  })
})
