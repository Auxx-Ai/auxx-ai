// packages/lib/src/table-views/structural-contexts.test.ts

import { describe, expect, it } from 'vitest'
import { viewContextTypes } from '../conditions/field-view-config'
import {
  BILLABLE_VIEW_CONTEXT_TYPES,
  isStructuralContextType,
  STRUCTURAL_CONTEXT_TYPES,
} from './structural-contexts'

/**
 * The `savedViews` plan limit meters saved views — artifacts a member creates,
 * names and picks. It must NOT meter definition configuration (the panel and
 * create/edit dialog field layouts), which is one row per def per context written
 * by a def admin.
 *
 * The partition test below is the point of this file: every view context type is
 * either structural (excluded from the limit) or billable (counted). Adding a
 * context type — `drawer` and `detail` are coming, see
 * plans/drawer/record-layout-system.md — fails this test until someone classifies
 * it, rather than silently defaulting it into the billing counter.
 */
describe('structural view contexts', () => {
  it('classifies the panel and dialog field layouts as structural', () => {
    expect([...STRUCTURAL_CONTEXT_TYPES]).toEqual(['panel', 'dialog_create', 'dialog_edit'])
  })

  it('leaves the member-authored contexts billable', () => {
    expect([...BILLABLE_VIEW_CONTEXT_TYPES]).toEqual(['table', 'kanban'])
  })

  it('partitions every known context type into exactly one bucket', () => {
    const structural = new Set<string>(STRUCTURAL_CONTEXT_TYPES)
    const billable = new Set<string>(BILLABLE_VIEW_CONTEXT_TYPES)

    // Disjoint.
    for (const contextType of structural) {
      expect(billable.has(contextType)).toBe(false)
    }
    // Exhaustive — a new context type in `viewContextTypes` lands in neither and fails here.
    expect([...structural, ...billable].sort()).toEqual([...viewContextTypes].sort())
  })

  it('recognises structural context types, and nothing else', () => {
    expect(isStructuralContextType('panel')).toBe(true)
    expect(isStructuralContextType('dialog_create')).toBe(true)
    expect(isStructuralContextType('dialog_edit')).toBe(true)
    expect(isStructuralContextType('table')).toBe(false)
    expect(isStructuralContextType('kanban')).toBe(false)
  })

  it('treats an absent context type as non-structural', () => {
    // `TableView.contextType` is `text()` defaulting to 'table', but the column is
    // nullable in the type and router inputs make it optional — a missing value must
    // not accidentally exempt a row from the limit.
    expect(isStructuralContextType(null)).toBe(false)
    expect(isStructuralContextType(undefined)).toBe(false)
    expect(isStructuralContextType('')).toBe(false)
    expect(isStructuralContextType('workflow-runs')).toBe(false)
  })
})
