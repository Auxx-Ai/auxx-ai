// packages/lib/src/custom-fields/__tests__/update-field-allow-new-options.test.ts

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

vi.mock('@auxx/database', () => ({
  database: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(mocks.currentRow ? [mocks.currentRow] : []) }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    selectDistinct: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
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

import { fieldAllowsNewOptions } from '../ownership'
import { updateCustomField } from '../update-field'

const OPTION_A = { value: 'opt_a', label: 'Brakes' }

/** The write that targeted the CustomField row, if any. */
function fieldWrite() {
  return mocks.writes.find((w) => w.table === CUSTOM_FIELD_TABLE)?.data
}

/** The options envelope this call persisted. */
function writtenOptions() {
  return fieldWrite()?.options as Record<string, unknown> | undefined
}

function setStoredField(options: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  mocks.currentRow = {
    type: 'TAGS',
    options,
    isUnique: false,
    modelType: 'ENTITY_INSTANCE',
    entityDefinitionId: 'def_1',
    systemAttribute: null,
    appInstallationId: null,
    ...overrides,
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

describe('updateCustomField — options.allowNewOptions', () => {
  describe('tri-state storage', () => {
    it('leaves the key absent when no patch ever set it', async () => {
      setStoredField({ options: [OPTION_A] })

      await updateCustomField({ ...BASE_INPUT, options: [OPTION_A] })

      // Absence is the third state, not a missing default. Nothing may
      // materialise it — that is what makes the setting need no backfill.
      expect(writtenOptions()).not.toHaveProperty('allowNewOptions')
    })

    it('persists false as false rather than collapsing it to absent', async () => {
      // The distinction that carries the whole feature: on a TAGS field absent
      // means "grows" and false means "the user closed it".
      setStoredField({ options: [OPTION_A] })

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: false } })

      const written = writtenOptions()
      expect(written).toHaveProperty('allowNewOptions')
      expect(written?.allowNewOptions).toBe(false)
    })

    it('persists true on a SINGLE_SELECT, overriding the closed type default', async () => {
      setStoredField({ options: [OPTION_A] }, { type: 'SINGLE_SELECT' })

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: true } })

      expect(writtenOptions()?.allowNewOptions).toBe(true)
    })

    it('clears the stored decision back to inheritance on null', async () => {
      setStoredField({ options: [OPTION_A], allowNewOptions: false })

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: null } })

      // Deleted, NOT rewritten to true. Storing the type default would freeze
      // the answer at whatever the type meant on the day of the write.
      expect(writtenOptions()).not.toHaveProperty('allowNewOptions')
    })

    it('leaves a stored decision alone when the patch does not mention it', async () => {
      setStoredField({ options: [OPTION_A], allowNewOptions: false })

      await updateCustomField({ ...BASE_INPUT, options: [OPTION_A] })

      expect(writtenOptions()?.allowNewOptions).toBe(false)
    })
  })

  describe('round-trips through the single reader', () => {
    // The write arm and `fieldAllowsNewOptions` are the only two halves of this
    // feature; if what one stores is not what the other reads, the setting is a
    // no-op that looks like it works.
    it('a stored false closes a TAGS field that would otherwise grow', async () => {
      setStoredField({ options: [OPTION_A] })
      expect(fieldAllowsNewOptions({ type: 'TAGS', options: {} })).toBe(true)

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: false } })

      expect(fieldAllowsNewOptions({ type: 'TAGS', options: writtenOptions() })).toBe(false)
    })

    it('a stored true opens a SINGLE_SELECT that would otherwise be closed', async () => {
      setStoredField({ options: [OPTION_A] }, { type: 'SINGLE_SELECT' })
      expect(fieldAllowsNewOptions({ type: 'SINGLE_SELECT', options: {} })).toBe(false)

      await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: true } })

      expect(fieldAllowsNewOptions({ type: 'SINGLE_SELECT', options: writtenOptions() })).toBe(true)
    })
  })

  describe('protected fields', () => {
    it('permits the flag on a system TAGS field (part.category)', async () => {
      // `canGrowFieldOptions` already says a system TAGS field may be grown by
      // an automated writer. If the preference could not be set here, that
      // authority would be unreachable on every seeded tag field there is.
      setStoredField({ options: [OPTION_A] }, { systemAttribute: 'category' })

      const result = await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: false } })

      expect(result.isOk()).toBe(true)
      expect(writtenOptions()?.allowNewOptions).toBe(false)
    })

    it('refuses the flag on an app-owned field', async () => {
      // Only uninstall edits an app's fields — including its taxonomies.
      setStoredField({ options: [OPTION_A] }, { appInstallationId: 'appinst_1' })

      const result = await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: true } })

      expect(result.isErr()).toBe(true)
      expect(fieldWrite()).toBeUndefined()
    })

    it('refuses the flag on an app-owned TAGS field even though it is TAGS', async () => {
      // The TAGS carve-out is `!appInstallationId && type === TAGS`; an app's
      // tag field is still an app's field.
      setStoredField({ options: [OPTION_A] }, { appInstallationId: 'appinst_1', type: 'TAGS' })

      const result = await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: true } })

      expect(result.isErr()).toBe(true)
    })

    it('refuses the flag on a system SINGLE_SELECT', async () => {
      // Its option set IS configuration — nothing should invent a ticket
      // status. `canGrowFieldOptions` refuses this field too, so there is
      // nothing on the other side of the setting to unlock.
      setStoredField({ options: [OPTION_A] }, { systemAttribute: 'status', type: 'SINGLE_SELECT' })

      const result = await updateCustomField({ ...BASE_INPUT, options: { allowNewOptions: true } })

      expect(result.isErr()).toBe(true)
      expect(fieldWrite()).toBeUndefined()
    })

    it('still refuses a name edit smuggled alongside the flag on a system field', async () => {
      // The carve-out is "options and nothing else". Growing it to admit the
      // flag must not have grown it to admit a definition edit.
      setStoredField({ options: [OPTION_A] }, { systemAttribute: 'category' })

      const result = await updateCustomField({
        ...BASE_INPUT,
        name: 'Renamed',
        options: { allowNewOptions: true },
      })

      expect(result.isErr()).toBe(true)
      expect(fieldWrite()).toBeUndefined()
    })
  })
})
