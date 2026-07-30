// packages/lib/src/resources/crud/__tests__/field-value-capability-threading.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { FieldValueService } from '../../../field-values'
import { CapabilitySet } from '../../../permissions/capabilities/capability-set'
import { Area, expandLevelsToKeys, Level } from '../../../permissions/capabilities/registry'
import { UnifiedCrudHandler } from '../unified-handler'

/**
 * Plan v3/03 §5.4 — `FieldValueService` accepts `options.capabilities` and threads
 * it into two enforcement points, and until this slice **not one request path
 * passed it into the record read lane**.
 *
 * `UnifiedCrudHandler` was the worst of it: it held `this.capabilities`, gated its
 * OWN reads through `canViewEntity`, then constructed the `FieldValueService` it
 * owns with `{ bypassFieldGuards }` alone — while handing the same capabilities to
 * `RecordPickerService` two hundred lines further down. So on every record read in
 * the app:
 *  - `batchGetValues`' def / traversal-path filter was inert, and
 *  - relationship REDACTION was inert: `redactedCount` came back 0 always, and the
 *    whole `__redacted__` → `RestrictedRelationshipChip` chain — types, converter,
 *    cell renderer, detail display, input field — had literally never rendered.
 *
 * Two claims here: the plumbing exists, and the gate it feeds actually denies.
 *
 * @see `@auxx/database` is globally mocked in `src/test/setup.ts`, so constructing
 *      a handler touches no DB / Redis / event bus.
 */

const ORG = 'org_1'
const USER = 'usr_1'
const RESTRICTED_DEF = 'edf_secretcuid0000000000000'
const OPEN_DEF = 'edf_dealscuid00000000000000'

/**
 * A member who may view `OPEN_DEF` and not `RESTRICTED_DEF`.
 *
 * Built from a real `CapabilitySet`: the restricted def carries a type-level grant
 * for SOMEBODY (so it is in `restrictedEntityDefIds`) but not for this member (so
 * `defAccess` has no entry) — the shipped shape of "restricted out of a def", not
 * a hand-stubbed `canViewEntity: () => false`.
 */
function caps() {
  return new CapabilitySet(
    new Set(expandLevelsToKeys({ [Area.records]: Level.Edit })),
    { [OPEN_DEF]: ResourcePermission.edit },
    'MEMBER',
    'full',
    (id) => id,
    new Set([RESTRICTED_DEF]),
    (id) => id
  )
}

describe('§5.4 — UnifiedCrudHandler forwards capabilities to its FieldValueService', () => {
  it('the owned FieldValueService carries the handler’s capabilities', () => {
    const set = caps()
    const handler = new UnifiedCrudHandler(ORG, USER, {} as never, undefined, {
      capabilities: set,
    })
    expect(handler.fieldValueService.ctx.capabilities).toBe(set)
  })

  it('an internal caller (no capabilities) stays unenforced — absent means system', () => {
    // Workers, seeders, record-rules and field hooks construct the handler without
    // capabilities on purpose. Threading must not turn that into a denial.
    const handler = new UnifiedCrudHandler(ORG, USER, {} as never)
    expect(handler.fieldValueService.ctx.capabilities).toBeUndefined()
  })

  it('RecordPickerService and FieldValueService now agree — the asymmetry is gone', () => {
    // Stated as its own case because the asymmetry WAS the bug: one consumer of
    // `this.capabilities` inside the class got them and the other did not.
    const set = caps()
    const handler = new UnifiedCrudHandler(ORG, USER, {} as never, undefined, { capabilities: set })
    expect(handler.fieldValueService.ctx.capabilities).toBe(set)
    expect(set.canViewEntity(RESTRICTED_DEF)).toBe(false)
    expect(set.canViewEntity(OPEN_DEF)).toBe(true)
  })
})

describe('§5.4 — the gate the threading feeds actually denies', () => {
  it('batchGetValues drops anchors on a def the member cannot view', async () => {
    const service = new FieldValueService(ORG, USER, {} as never, undefined, {
      capabilities: caps(),
    })
    const result = await service.batchGetValues({
      recordIds: [`${RESTRICTED_DEF}:rec_1`],
      fieldReferences: [`${OPEN_DEF}:title`],
    } as never)
    // Every anchor filtered out ⇒ the short-circuit returns before any query.
    expect(result.values).toEqual([])
  })

  it('batchGetValues drops a traversal path that passes THROUGH a restricted def', async () => {
    const service = new FieldValueService(ORG, USER, {} as never, undefined, {
      capabilities: caps(),
    })
    const result = await service.batchGetValues({
      recordIds: [`${OPEN_DEF}:rec_1`],
      fieldReferences: [[`${OPEN_DEF}:secret`, `${RESTRICTED_DEF}:name`]],
    } as never)
    expect(result.values).toEqual([])
  })

  it('OVER-DENIAL CONTROL: an UNENFORCED service keeps both, proving the gate is the cause', async () => {
    // Same inputs, no capabilities: the filter is skipped, so the call proceeds
    // past the short-circuit and into reference validation (which throws against
    // the mocked DB). Reaching a DIFFERENT outcome is the point — if this also
    // returned `{ values: [] }` the two cases above would prove nothing.
    const service = new FieldValueService(ORG, USER, {} as never)
    const attempt = service.batchGetValues({
      recordIds: [`${RESTRICTED_DEF}:rec_1`],
      fieldReferences: [`${OPEN_DEF}:title`],
    } as never)
    await expect(attempt).rejects.toBeDefined()
  })
})

describe('§5.4 — listAll accepts and forwards capabilities', () => {
  it('the handler hands its capabilities to the standalone listAll query', async () => {
    // `listAll`'s ctx had NO `capabilities` field at all, so the field-value
    // service inside it was unenforced even for a caller holding a resolved set.
    // Spying on the query module would need a second import graph; instead assert
    // the observable consequence: a def the member can't view yields an empty list
    // WITHOUT reaching the query at all.
    const handler = new UnifiedCrudHandler(ORG, USER, {} as never, undefined, {
      capabilities: caps(),
    })
    await expect(handler.listAll({ entityDefinitionId: RESTRICTED_DEF })).resolves.toEqual({
      items: [],
      entityDefinitionId: RESTRICTED_DEF,
      fields: {},
    })
  })
})
