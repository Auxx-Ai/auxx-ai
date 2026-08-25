// packages/lib/src/custom-fields/__tests__/update-field-ai-options.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.mock` factories are hoisted above every top-level binding, so the mock's
// shared state has to be hoisted with them.
const mocks = vi.hoisted(() => ({
  customFieldTable: { id: 'CustomField.id', organizationId: 'CustomField.organizationId' },
  fieldValueTable: { fieldId: 'FieldValue.fieldId', organizationId: 'FieldValue.organizationId' },
  /** The row `updateCustomField` reads before deciding what to write. */
  currentRow: undefined as Record<string, unknown> | undefined,
  /** Every `update(table).set(data)` the call made, in order. */
  writes: [] as Array<{ table: unknown; data: Record<string, unknown> }>,
}))

const CUSTOM_FIELD_TABLE = mocks.customFieldTable
const FIELD_VALUE_TABLE = mocks.fieldValueTable

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(mocks.currentRow ? [mocks.currentRow] : []) }),
      }),
    }),
    // The option cascade runs after the field write whenever the patch carries
    // options. Without these two the cascade throws into its best-effort catch,
    // which passes the tests but silently exercises nothing.
    delete: () => ({
      where: () => ({ returning: () => Promise.resolve([]) }),
    }),
    selectDistinct: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    // The update terminal must be awaitable directly AND chainable with
    // `.returning()`: `updateCustomField` awaits `.where(...)` on its own for
    // the aiStatus clear, but calls `.where(...).returning()` for the field row.
    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => {
        mocks.writes.push({ table, data })
        return {
          where: () => ({
            returning: () => Promise.resolve([{ id: 'field_1', ...data }]),
            // biome-ignore lint/suspicious/noThenProperty: a Drizzle query builder IS a thenable; the mock has to be one too
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve, reject),
          }),
        }
      },
    }),
  },
  schema: { CustomField: mocks.customFieldTable, FieldValue: mocks.fieldValueTable },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ col, val }),
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
}))

import { updateCustomField } from '../update-field'

const PROMPT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Categorise this record' }] }],
}

const STORED_AI = {
  enabled: true,
  prompt: PROMPT,
  triggerOn: 'manual' as const,
  allowNewOptions: true,
}

const OPTION_A = { value: 'opt_a', label: 'Enterprise' }
const OPTION_B = { value: 'opt_b', label: 'SMB' }

/** The write that targeted the CustomField row. */
function fieldWrite() {
  return mocks.writes.find((w) => w.table === CUSTOM_FIELD_TABLE)?.data
}

/** Whether the call cleared `aiStatus` on the field's values. */
function clearedAiStatus() {
  return mocks.writes.some((w) => w.table === FIELD_VALUE_TABLE && w.data.aiStatus === null)
}

function setStoredField(options: Record<string, unknown>, type = 'TAGS') {
  mocks.currentRow = {
    type,
    options,
    isUnique: false,
    modelType: 'ENTITY_INSTANCE',
    entityDefinitionId: 'def_1',
    systemAttribute: null,
    appInstallationId: null,
  }
}

const BASE_INPUT = {
  resourceFieldId: 'def_1:field_1' as never,
  organizationId: 'org_1',
}

beforeEach(() => {
  mocks.writes = []
  mocks.currentRow = undefined
})

describe('updateCustomField — options.ai preservation', () => {
  describe('options-only array patch (the record-side tag picker)', () => {
    it('preserves the stored ai block when a tag is added', async () => {
      setStoredField({ options: [OPTION_A], ai: STORED_AI })

      const result = await updateCustomField({
        ...BASE_INPUT,
        options: [OPTION_A, OPTION_B],
      })

      expect(result.isOk()).toBe(true)
      const written = fieldWrite()?.options as Record<string, unknown>
      // The whole point: typing a new tag on a record must not destroy the
      // field's AI configuration.
      expect(written.ai).toEqual(STORED_AI)
      expect(written.options).toEqual([OPTION_A, OPTION_B])
    })

    it('preserves the stored ai block when a tag is deleted', async () => {
      setStoredField({ options: [OPTION_A, OPTION_B], ai: STORED_AI })

      await updateCustomField({ ...BASE_INPUT, options: [OPTION_A] })

      const written = fieldWrite()?.options as Record<string, unknown>
      expect(written.ai).toEqual(STORED_AI)
      expect(written.options).toEqual([OPTION_A])
    })

    it('does not clear the aiStatus marker on the field values', async () => {
      setStoredField({ options: [OPTION_A], ai: STORED_AI })

      await updateCustomField({ ...BASE_INPUT, options: [OPTION_A, OPTION_B] })

      expect(clearedAiStatus()).toBe(false)
    })

    it('rejects emptying the option list of a constrained AI-enabled select', async () => {
      setStoredField(
        { options: [OPTION_A], ai: { ...STORED_AI, allowNewOptions: false } },
        'SINGLE_SELECT'
      )

      const result = await updateCustomField({ ...BASE_INPUT, options: [] })

      expect(result.isErr()).toBe(true)
      expect(fieldWrite()).toBeUndefined()
    })

    it('allows emptying the option list of an open TAGS field', async () => {
      // `allowNewOptions` means there is no enum to satisfy, so an empty list
      // is a legitimate starting state.
      setStoredField({ options: [OPTION_A], ai: STORED_AI })

      const result = await updateCustomField({ ...BASE_INPUT, options: [] })

      expect(result.isOk()).toBe(true)
    })
  })

  describe('object-shaped patch (the field form)', () => {
    it('preserves the stored option list when the patch carries only ai', async () => {
      // TAGS renders no options editor in the field form, so enabling AI sends
      // `{ ai }` alone — the tag taxonomy must survive it.
      setStoredField({ options: [OPTION_A, OPTION_B], icon: 'tag' })

      const result = await updateCustomField({
        ...BASE_INPUT,
        options: { ai: STORED_AI } as never,
      })

      expect(result.isOk()).toBe(true)
      const written = fieldWrite()?.options as Record<string, unknown>
      expect(written.options).toEqual([OPTION_A, OPTION_B])
      expect(written.ai).toEqual(STORED_AI)
    })

    it('still strips the ai block on toggle-off', async () => {
      setStoredField({ options: [OPTION_A], ai: STORED_AI }, 'MULTI_SELECT')

      const result = await updateCustomField({
        ...BASE_INPUT,
        options: { options: [OPTION_A] } as never,
      })

      expect(result.isOk()).toBe(true)
      const written = fieldWrite()?.options as Record<string, unknown>
      expect(written.ai).toBeUndefined()
      // Toggle-off also retires the per-value markers.
      expect(clearedAiStatus()).toBe(true)
    })
  })

  // `options.allowNewOptions` is the envelope-level taxonomy flag — a sibling of
  // `options` / `ai` / `file`, and the first key ever added beside the option
  // array. Under the old `touchesAi = !Array.isArray(options)` test EVERY patch
  // in this block would have read as an AI toggle-off.
  describe('taxonomy flag (options.allowNewOptions)', () => {
    it('preserves the stored ai block when only the flag is set', async () => {
      setStoredField({ options: [OPTION_A], ai: STORED_AI })

      const result = await updateCustomField({
        ...BASE_INPUT,
        options: { allowNewOptions: true },
      })

      expect(result.isOk()).toBe(true)
      const written = fieldWrite()?.options as Record<string, unknown>
      expect(written.ai).toEqual(STORED_AI)
      expect(written.allowNewOptions).toBe(true)
      // …and the taxonomy it is a flag about survives untouched.
      expect(written.options).toEqual([OPTION_A])
    })

    it('does not clear the aiStatus marker on the field values', async () => {
      setStoredField({ options: [OPTION_A], ai: STORED_AI })

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: false } })

      expect(clearedAiStatus()).toBe(false)
    })

    it('leaves ai.allowNewOptions alone — the two flags are independent', async () => {
      // Same name, two owners: `ai.allowNewOptions` asks whether the MODEL may
      // invent labels, the envelope one asks whether an IMPORT may. Closing the
      // field to imports must not touch what the model is allowed to do.
      setStoredField({ options: [OPTION_A], ai: STORED_AI })

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: false } })

      const written = fieldWrite()?.options as Record<string, unknown>
      expect((written.ai as Record<string, unknown>).allowNewOptions).toBe(true)
      expect(written.allowNewOptions).toBe(false)
    })

    it('carrying the flag does not change an envelope AI verdict', async () => {
      // The orthogonality contract: `{ options, allowNewOptions }` must do to
      // `ai` exactly what `{ options }` does — strip it — and NOT be rescued
      // into a preserve just because it grew a key.
      setStoredField({ options: [OPTION_A], ai: STORED_AI }, 'MULTI_SELECT')

      const result = await updateCustomField({
        ...BASE_INPUT,
        options: { options: [OPTION_A], allowNewOptions: true },
      })

      expect(result.isOk()).toBe(true)
      const written = fieldWrite()?.options as Record<string, unknown>
      expect(written.ai).toBeUndefined()
      expect(clearedAiStatus()).toBe(true)
      expect(written.allowNewOptions).toBe(true)
    })

    it('saves option list, ai block and flag in one patch', async () => {
      // What the field editor sends: one envelope, three concerns.
      setStoredField({ options: [OPTION_A] }, 'MULTI_SELECT')

      const result = await updateCustomField({
        ...BASE_INPUT,
        options: { options: [OPTION_A, OPTION_B], ai: STORED_AI, allowNewOptions: true },
      })

      expect(result.isOk()).toBe(true)
      const written = fieldWrite()?.options as Record<string, unknown>
      expect(written.options).toEqual([OPTION_A, OPTION_B])
      expect(written.ai).toEqual(STORED_AI)
      expect(written.allowNewOptions).toBe(true)
    })
  })
})
