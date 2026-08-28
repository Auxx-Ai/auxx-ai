// packages/lib/src/field-hooks/pre/build-status-guard.test.ts
//
// 🛑 The bug this file exists to prevent is a guard that cannot fire. By the time
// `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a SINGLE_SELECT write into
// `{ type: 'option', optionId: 'completed' }` — never the bare string `'completed'` — so a
// guard comparing `event.newValue` to `'completed'` passes everything and is
// indistinguishable from a guard nothing has tripped. It reads correctly in review and
// passes any unit test that only feeds it a bare string
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §2).
//
// So every rejection case below feeds the COERCED envelope the client path actually
// produces. A version of `guardManualBuildLifecycleStatus` that only understood bare strings
// would pass `rejects a bare string` and fail every `coerced(...)` case — which is exactly
// the discrimination this file is for.

import { describe, expect, it } from 'vitest'
import { BadRequestError } from '../../errors'
import {
  BUILD_ACTION_STATUS_MESSAGE,
  BUILD_ACTION_STATUSES,
} from '../../resources/hooks/lifecycle-status-guard'
import type { FieldPreHookEvent } from '../types'
import { guardManualBuildLifecycleStatus } from './build-status-guard'

/** The shape `validateAndConvertValue` hands a SINGLE_SELECT pre-hook. */
function coerced(optionId: string) {
  return { type: 'option', optionId }
}

function event(newValue: unknown): FieldPreHookEvent {
  return {
    recordId: 'def-build:bld-1',
    entityDefinitionId: 'def-build',
    entityType: 'build',
    entitySlug: 'builds',
    fieldId: 'f-status',
    systemAttribute: 'build_status',
    field: { id: 'f-status', systemAttribute: 'build_status' },
    newValue,
    // Deliberately `undefined`, because that is what `fireFieldPreHooks` passes on the
    // single-field path. It is also why this guard is a VALUE wall rather than a transition
    // wall: a guard that tried to read the previous status here would never fire.
    existingValue: undefined,
    allValues: new Map<string, unknown>(),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
  } as unknown as FieldPreHookEvent
}

describe('build_status manual-write wall', () => {
  it('guards exactly in_progress, completed and canceled', () => {
    expect([...BUILD_ACTION_STATUSES]).toEqual(['in_progress', 'completed', 'canceled'])
  })

  it.each([
    ...BUILD_ACTION_STATUSES,
  ])('rejects the coerced option envelope for %s', async (status) => {
    await expect(guardManualBuildLifecycleStatus(event(coerced(status)))).rejects.toThrow(
      BadRequestError
    )
  })

  // 🛑 The one that matters most. `completeBuild` writes the consume/produce movements,
  // stamps five cost fields and computes the variance; a hand-set `completed` records a
  // finished production run with none of it, and every downstream read believes it.
  it('rejects a hand-set completed — a build with no ledger behind it', async () => {
    await expect(guardManualBuildLifecycleStatus(event(coerced('completed')))).rejects.toThrow(
      BUILD_ACTION_STATUS_MESSAGE
    )
  })

  it('names the actions, so the message says which button to press', async () => {
    await expect(guardManualBuildLifecycleStatus(event(coerced('canceled')))).rejects.toThrow(
      'Use the build actions (Start / Complete / Cancel / Reverse) to set this status'
    )
  })

  // A guard that only handled the envelope would be half-dead the moment a caller writes an
  // already-typed value.
  it.each([...BUILD_ACTION_STATUSES])('rejects a bare string %s too', async (status) => {
    await expect(guardManualBuildLifecycleStatus(event(status))).rejects.toThrow(BadRequestError)
  })

  it('rejects a single-element array of either shape', async () => {
    await expect(guardManualBuildLifecycleStatus(event([coerced('completed')]))).rejects.toThrow(
      BadRequestError
    )
    await expect(guardManualBuildLifecycleStatus(event(['completed']))).rejects.toThrow(
      BadRequestError
    )
  })

  // 🛑 `planned` is `build_status`'s `defaultValue`, and `applyDefaults` injects a creatable
  // field's default into EVERY create before the write reaches this chain — which, unlike
  // the system-hook chain, has no `operation === 'create'` exemption. Guarding it would
  // refuse every build create through the generic door, not merely one carrying an unusual
  // status. Same structural reason `draft` is absent from the quote and invoice sets.
  it('leaves planned freely editable — it is the defaultValue every create carries', async () => {
    const next = coerced('planned')
    await expect(guardManualBuildLifecycleStatus(event(next))).resolves.toBe(next)
    await expect(guardManualBuildLifecycleStatus(event(['planned']))).resolves.toEqual(['planned'])
  })

  it('lets a clear through rather than treating null as a guarded value', async () => {
    await expect(guardManualBuildLifecycleStatus(event(null))).resolves.toBeNull()
  })

  it('returns the value untouched — it is a guard, not a transform', async () => {
    const next = coerced('planned')
    await expect(guardManualBuildLifecycleStatus(event(next))).resolves.toBe(next)
  })

  // The build guard is built from the same factory as the quote and invoice ones, so
  // swapping the constant arrays is a one-character mistake nothing else would catch.
  it('does not reject another document status that happens to share the field', async () => {
    for (const foreign of ['sent', 'approved', 'paid', 'void', 'issued', 'closed']) {
      const next = coerced(foreign)
      await expect(guardManualBuildLifecycleStatus(event(next))).resolves.toBe(next)
    }
  })
})
