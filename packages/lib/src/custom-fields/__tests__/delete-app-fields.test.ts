// packages/lib/src/custom-fields/__tests__/delete-app-fields.test.ts
// deleteAppFields (uninstall lifecycle path, app-fields-and-entities plan §4.4 fix 3):
// routes every field an app installation owns through deleteCustomField (with
// `allowProtectedDeletion: true`) instead of a raw table delete, so a RELATIONSHIP
// field's inverse and any display-field references get the same cleanup a user-facing
// delete would. Before this it was a bare `tx.delete(schema.CustomField)`.

import { database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../entity-instances/batch-update-display-values', () => ({
  clearDisplayValues: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../field-values/search-text', () => ({
  updateSearchTextForEntityDefinition: vi.fn().mockResolvedValue(undefined),
}))

import { deleteAppFields } from '../delete-field'

/** A minimal chainable `.from().where()[.limit()]` stand-in that resolves to `rows`
 *  either via `.limit()` or by being awaited directly (both call shapes appear in
 *  `deleteCustomField`'s internals). */
function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: vi.fn(() => c),
    where: vi.fn(() => c),
    limit: vi.fn(() => Promise.resolve(rows)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
  return c
}

/** A mutation chain (`delete`/`update`) whose terminal `.where()` resolves to `undefined`. */
function mutChain() {
  return { where: vi.fn().mockResolvedValue(undefined) }
}

function makeInnerTx() {
  return {
    delete: vi.fn(() => mutChain()),
    // The CALC-fields dependency scan — nothing depends on the deleted field(s) here.
    select: vi.fn(() => chain([])),
    update: vi.fn(() => ({ set: vi.fn(() => mutChain()) })),
  }
}

const TEXT_FIELD = {
  id: 'field_1',
  organizationId: 'org_1',
  entityDefinitionId: 'def_1',
  appInstallationId: 'inst_1',
  systemAttribute: null,
  type: 'TEXT',
  options: null,
}

const RELATIONSHIP_FIELD = {
  id: 'field_1',
  organizationId: 'org_1',
  entityDefinitionId: 'def_1',
  appInstallationId: 'inst_1',
  systemAttribute: null,
  type: 'RELATIONSHIP',
  // `getInverseFieldId` parses this as `{ entityDefinitionId: 'def_2', fieldId: 'field_2' }`.
  options: { relationship: { inverseResourceFieldId: 'def_2:field_2' } },
}

beforeEach(() => {
  vi.mocked(database.select).mockReset()
  vi.mocked(database.transaction).mockReset()
})

describe('deleteAppFields', () => {
  it('deletes an app-owned field via deleteCustomField(allowProtectedDeletion: true) — a raw delete would leave it protected and refused', async () => {
    // `tx` is what the uninstall flow passes in — used only to find the ids to remove.
    const outerSelect = vi.fn(() =>
      chain([
        {
          id: TEXT_FIELD.id,
          entityDefinitionId: TEXT_FIELD.entityDefinitionId,
          organizationId: TEXT_FIELD.organizationId,
        },
      ])
    )
    const outerTx = { select: outerSelect } as never

    // The module-level `database` is what `deleteCustomField`'s own internals use.
    vi.mocked(database.select).mockImplementation(() => chain([TEXT_FIELD]) as never)
    vi.mocked(database.transaction).mockImplementation(((cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeInnerTx())) as never)

    const result = await deleteAppFields({ appInstallationId: 'inst_1' }, outerTx)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.deletedFieldIds).toEqual(['field_1'])
    }
    expect(outerSelect).toHaveBeenCalledTimes(1)
    // `isProtectedField` would refuse this field (appInstallationId set) without
    // `allowProtectedDeletion`; a successful transaction proves it was passed through.
    expect(database.transaction).toHaveBeenCalledTimes(1)
  })

  it('deletes a RELATIONSHIP field once, not twice, when both sides carry the same appInstallationId', async () => {
    // The lifecycle query finds BOTH the forward field and its auto-created inverse — the
    // inverse rides along with the same `appInstallationId` (see `create-field.ts`). Deleting
    // the forward field already deletes the inverse as a side effect, so processing the
    // inverse's own row must be a no-op, not a second `deleteCustomField` call.
    const outerSelect = vi.fn(() =>
      chain([
        {
          id: 'field_1',
          entityDefinitionId: 'def_1',
          organizationId: 'org_1',
        },
        {
          id: 'field_2',
          entityDefinitionId: 'def_2',
          organizationId: 'org_1',
        },
      ])
    )
    const outerTx = { select: outerSelect } as never

    vi.mocked(database.select).mockImplementation(() => chain([RELATIONSHIP_FIELD]) as never)
    vi.mocked(database.transaction).mockImplementation(((cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeInnerTx())) as never)

    const result = await deleteAppFields({ appInstallationId: 'inst_1' }, outerTx)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.deletedFieldIds).toEqual(['field_1', 'field_2'])
    }
    // One `deleteCustomField` call (one transaction) deletes both sides of the pair.
    expect(database.transaction).toHaveBeenCalledTimes(1)
  })
})
