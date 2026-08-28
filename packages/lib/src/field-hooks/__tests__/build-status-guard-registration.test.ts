// packages/lib/src/field-hooks/__tests__/build-status-guard-registration.test.ts
//
// 🛑 `build_status` is guarded on the FIELD pre-hook chain and deliberately NOT on the
// system-hook chain, which is a departure from `quote_status` / `invoice_status` /
// `purchase_order_status`. The reason is mechanical and this file is what keeps it from
// being "fixed" by someone restoring symmetry:
//
//   - `UnifiedCrudHandler.runPreHooks` consults no equivalent of `bypassFieldGuards`.
//   - `startBuild`, `cancelBuild` and `completeBuild` all write `build_status` through
//     `UnifiedCrudHandler.update`, so a system twin would refuse the three actions it exists
//     to protect — trap 2 of plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4
//     arriving on a chain with no way to answer it.
//   - It would add no coverage either: `record.create` / `record.update`, the CSV importer
//     and the SDK all reach field values through `setFieldValues` -> `FieldValueService` ->
//     `fireFieldPreHooks`, so the field guard already sees them.
//
// Separate from `pre/build-status-guard.test.ts` because `getFieldPreHooks` self-inits the
// whole hook bootstrap, which needs the real `@auxx/database` module graph.

import { describe, expect, it } from 'vitest'
import { guardManualBuildLifecycleStatus } from '../pre/build-status-guard'
import { getFieldPreHooks, hasFieldPreHooks } from '../registry'
import type { FieldPreHookEvent } from '../types'

describe('build_status guard registration', () => {
  // The slug, not the entityType: `fireFieldPreHooks` keys off `resource.apiSlug`, which is
  // `builds`. Registering under `build` would be a silent no-op.
  it('is on the field pre-hook chain for builds', () => {
    expect(hasFieldPreHooks('builds', 'build_status')).toBe(true)
    expect(getFieldPreHooks('builds', 'build_status')).toContain(guardManualBuildLifecycleStatus)
  })

  it('is registered under the apiSlug, not the entityType', () => {
    expect(hasFieldPreHooks('build', 'build_status')).toBe(false)
  })

  // 🛑 Not an oversight. See the header — a system twin would break Start, Complete and
  // Cancel, because system hooks cannot be bypassed and those three write through
  // `UnifiedCrudHandler.update`.
  it('has NO system-hook twin, on purpose', async () => {
    const { getHooksForAttribute } = await import('../../resources/hooks/system-hooks')
    expect(getHooksForAttribute('build', 'build_status')).toHaveLength(0)
  })

  it('leaves the build number hook alone on the system chain', async () => {
    const { getHooksForAttribute } = await import('../../resources/hooks/system-hooks')
    expect(getHooksForAttribute('build', 'build_number')).toHaveLength(1)
  })
})

describe('one source for what build_status guards', () => {
  it('reads its set and message from the shared lifecycle module', async () => {
    const { BUILD_ACTION_STATUSES, BUILD_ACTION_STATUS_MESSAGE } = await import(
      '../../resources/hooks/lifecycle-status-guard'
    )
    expect([...BUILD_ACTION_STATUSES]).toEqual(['in_progress', 'completed', 'canceled'])

    // The SAME value, in the shape the field chain actually delivers — never a bare string.
    await expect(
      guardManualBuildLifecycleStatus({
        newValue: { type: 'option', optionId: 'completed' },
      } as unknown as FieldPreHookEvent)
    ).rejects.toThrow(BUILD_ACTION_STATUS_MESSAGE)
  })

  // The three money sets are untouched by this change. If one of them grows a build value
  // (or the build set grows a money one) the factory would guard the wrong document.
  it('does not overlap the quote, invoice or purchase-order sets', async () => {
    const {
      BUILD_ACTION_STATUSES,
      INVOICE_ACTION_STATUSES,
      PURCHASE_ORDER_ACTION_STATUSES,
      QUOTE_ACTION_STATUSES,
    } = await import('../../resources/hooks/lifecycle-status-guard')

    const build = new Set<string>(BUILD_ACTION_STATUSES)
    for (const other of [
      QUOTE_ACTION_STATUSES,
      INVOICE_ACTION_STATUSES,
      PURCHASE_ORDER_ACTION_STATUSES,
    ]) {
      for (const value of other) expect(build.has(value)).toBe(false)
    }
  })
})
