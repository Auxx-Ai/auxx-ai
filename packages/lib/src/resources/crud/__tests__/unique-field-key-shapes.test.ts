// packages/lib/src/resources/crud/__tests__/unique-field-key-shapes.test.ts
//
// 🛑 `validateUniqueFields` is the handler's PRE-WRITE uniqueness gate, and it
// used to be a no-op for half its callers.
//
// Values reach the handler keyed by fieldId OR by systemAttribute. Both other
// functions in the same call chain accept both - `setFieldValues` builds a
// `keyToIdMap` off `systemAttribute ?? name`, and `runPreHooks` tests both keys
// for the reason its own comment gives ("a systemAttribute-keyed update would
// silently bypass update hooks"). This one read `values[field.id]` alone, so
// `chart-write.ts` writing `gl_account_code` and ingest writing `primary_email`
// skipped it entirely.
//
// ⚠️ What that produced was not a silent success, which is what makes it hard to
// spot. The field-value layer has its OWN uniqueness gate and it throws - but
// `setValuesForEntity` catches per field, records `state: 'failed'` (which
// nothing reads) and carries on, so the record wrote without the field and the
// caller was told it worked. `addValues` has no such catch, so the same logical
// write propagated or vanished depending only on whether the field happened to
// be multi-value. This gate is what makes the two agree.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every `checkUniqueValue` call the gate made, as `{ fieldId, value }`. */
  checked: [] as { fieldId: string; value: unknown }[],
  /** Values that should report as taken by another record. */
  taken: new Set<string>(),
  fields: [] as {
    id: string
    name: string
    systemAttribute: string | null
    isUnique: boolean
  }[],
}))

vi.mock('../../../cache', () => ({
  getCachedCustomFields: async () => h.fields,
  findCachedResource: async () => null,
  getCachedResources: async () => [],
}))

vi.mock('../../../custom-fields', () => ({
  checkUniqueValue: async ({ fieldId, value }: { fieldId: string; value: unknown }) => {
    h.checked.push({ fieldId, value })
    return h.taken.has(String(value))
      ? { isErr: () => true, error: { existingEntityId: 'other_record' } }
      : { isErr: () => false }
  },
}))

import { UnifiedCrudHandler } from '../unified-handler'

const ORG = 'org_1'
const USER = 'user_1'
const DEF = 'def_gl_account'
const CODE_FIELD = 'fld_code'

/** The private gate, reached the way a test may reach one. */
function gate(handler: UnifiedCrudHandler) {
  return (values: Record<string, unknown>, excludeEntityId?: string) =>
    (
      handler as unknown as {
        validateUniqueFields: (
          defId: string,
          values: Record<string, unknown>,
          excludeEntityId?: string
        ) => Promise<void>
      }
    ).validateUniqueFields(DEF, values, excludeEntityId)
}

beforeEach(() => {
  h.checked = []
  h.taken = new Set()
  h.fields = [
    { id: CODE_FIELD, name: 'Code', systemAttribute: 'gl_account_code', isUnique: true },
    { id: 'fld_name', name: 'Name', systemAttribute: 'gl_account_name', isUnique: false },
  ]
})

describe('validateUniqueFields: the key shapes a caller may use', () => {
  it('checks a value keyed by fieldId', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ [CODE_FIELD]: '1310' })

    expect(h.checked).toEqual([{ fieldId: CODE_FIELD, value: '1310' }])
  })

  // 🛑 THE regression. This is how `chart-write.ts` and ingest key their values,
  // and before the fix the gate looked straight past them.
  it('checks a value keyed by systemAttribute', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ gl_account_code: '1310' })

    expect(h.checked).toEqual([{ fieldId: CODE_FIELD, value: '1310' }])
  })

  it('falls back to the field NAME for a custom field with no systemAttribute', async () => {
    h.fields = [{ id: 'fld_promo', name: 'Promo Code', systemAttribute: null, isUnique: true }]
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ 'Promo Code': 'SUMMER' })

    expect(h.checked).toEqual([{ fieldId: 'fld_promo', value: 'SUMMER' }])
  })

  it('refuses a taken value, naming the conflicting one', async () => {
    h.taken.add('1310')
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await expect(check({ gl_account_code: '1310' })).rejects.toMatchObject({
      conflictingValue: '1310',
      fieldId: CODE_FIELD,
      existingEntityId: 'other_record',
    })
  })

  it('lets a record keep its own value, via excludeEntityId', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ gl_account_code: '1310' }, 'my_record')

    // The exclusion is the unique checker's job; what matters here is that the
    // gate forwarded the check rather than skipping it.
    expect(h.checked).toHaveLength(1)
  })

  // Precedence matches `setFieldValues`, which prefers an explicit UUID match so
  // a caller mixing both shapes in one call behaves identically in both places.
  it('prefers the fieldId key when a caller supplies both shapes', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ [CODE_FIELD]: '1310', gl_account_code: '9999' })

    expect(h.checked).toEqual([{ fieldId: CODE_FIELD, value: '1310' }])
  })

  it('ignores a field that is not unique, whichever way it is keyed', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ gl_account_name: 'Raw Materials' })

    expect(h.checked).toEqual([])
  })

  it('skips a clear, so emptying a unique field never collides', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ gl_account_code: null })
    await check({ gl_account_code: '' })

    expect(h.checked).toEqual([])
  })

  it('checks each element of a multi-value field, not the array', async () => {
    const check = gate(new UnifiedCrudHandler(ORG, USER))

    await check({ gl_account_code: ['1310', '1320'] })

    expect(h.checked).toEqual([
      { fieldId: CODE_FIELD, value: '1310' },
      { fieldId: CODE_FIELD, value: '1320' },
    ])
  })
})
