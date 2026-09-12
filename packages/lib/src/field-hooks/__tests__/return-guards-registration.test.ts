// packages/lib/src/field-hooks/__tests__/return-guards-registration.test.ts
//
// 🛑 The `return` guards exist on BOTH chains, and that is the point of this file.
//
// The system-hook chain (`resources/hooks/return-hooks.ts`) is COVERAGE: it fires for
// `record.create` / `record.update`, bulk writes, the CSV importer and the SDK. Every
// INTERACTIVE edit - the drawer, the grid's inline edit, a kanban drag, a Kopilot record
// tool - goes `fieldValue.set` -> `FieldValueService` -> `fireFieldPreHooks` and never
// reads that registry (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §1).
//
// `return` is a VISIBLE def with a route folder whose status warehouse staff drive by hand
// from the drawer, so the system chain alone would have guarded the door nobody uses. Both
// guards shipped there first; these registrations are what make them real.
//
// Unlike `build_status`, keeping both chains is safe here: `return` has no action writers.
// `return_status` is written only by `buildReturnValues` (a generic editor, which is exactly
// the write the graph polices), and the two `return_line` attributes are written by
// `createReturnLine` / `updateReturnLine`, which run the same ceiling check themselves and
// reach the same verdict rather than needing an exemption. The first action writer added
// must carry `bypassFieldGuards`.
//
// Separate from the colocated `pre/*.test.ts` because `getFieldPreHooks` self-inits the whole
// hook bootstrap, which needs the real `@auxx/database` module graph.

import { describe, expect, it } from 'vitest'
import {
  guardReturnLineOverReturn,
  OVER_RETURN_GUARDED_ATTRS,
} from '../pre/return-line-over-return-guard'
import { guardReturnLifecycleTransition } from '../pre/return-status-guard'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'

describe('return guard registration', () => {
  it('guards return_status on the field pre-hook chain', () => {
    expect(hasFieldPreHooks('returns', 'return_status')).toBe(true)
    expect(getFieldPreHooks('returns', 'return_status')).toContain(guardReturnLifecycleTransition)
  })

  it('guards every over-return attribute, not just the quantity', () => {
    // Re-pointing a line at a different sold line breaches the ceiling exactly as
    // raising its quantity does, so both attributes carry the guard.
    expect(OVER_RETURN_GUARDED_ATTRS.length).toBeGreaterThan(1)
    for (const attribute of OVER_RETURN_GUARDED_ATTRS) {
      expect(hasFieldPreHooks('return-lines', attribute)).toBe(true)
      expect(getFieldPreHooks('return-lines', attribute)).toContain(guardReturnLineOverReturn)
    }
  })

  // 🛑 `fireFieldPreHooks` keys off `resource.apiSlug`. The entityTypes are `return` and
  // `return_line`; the slugs are `returns` and `return-lines`. Registering under the
  // entityType compiles, reads correctly in review, and is a silent no-op - the same
  // inert-guard failure the whole plan above is about.
  it('is registered under the apiSlug, never the entityType', () => {
    expect(hasFieldPreHooks('return', 'return_status')).toBe(false)
    for (const attribute of OVER_RETURN_GUARDED_ATTRS) {
      expect(hasFieldPreHooks('return_line', attribute)).toBe(false)
    }
  })
})
