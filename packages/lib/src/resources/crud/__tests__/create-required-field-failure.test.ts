// packages/lib/src/resources/crud/__tests__/create-required-field-failure.test.ts
//
// A create that loses a REQUIRED field must not succeed. `setValuesForEntity`
// swallows a per-field throw and continues, which is right for an edit and
// wrong for a create: the required-presence check ran before coercion, the
// value was present, coercion refused it, and the record landed without it.
// The importer produced 232 supplier offers with no supplier this way
// (plans/importer/09-relation-create-record-id.md §1). `createEntity` now reads
// the failures `setFieldValues` reports, rolls the instance back when a
// required field is among them, and throws 422 with the swallowed reason.
//
// @auxx/database is globally mocked in src/test/setup.ts; the mutation-seam
// mocks mirror sync-lifecycle-capture.test.ts.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
}))

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', archivedAt: null })),
  getEntityInstanceRow: vi.fn(async () => ({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  deleteEntityInstance: h.deleteEntityInstance,
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  publishRecordsChanged: vi.fn(async () => {}),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource: vi.fn(async () => undefined),
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
    deleteCommentsByRecordId = vi.fn(async () => {})
  },
}))

import { UnprocessableEntityError } from '../../../errors'
import {
  createEntity,
  type FieldWriteFailure,
  type MutationContext,
} from '../unified-handler-mutations'
import { interactiveSession } from '../write-origin'

/** Minimal CustomField-shaped rows for the create path's field plumbing. */
function fieldRow(id: string, systemAttribute: string, required: boolean) {
  return { id, name: id, systemAttribute, required, isCreatable: true }
}

function ctx(fields: unknown[], failures: FieldWriteFailure[]): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    session: interactiveSession('user_1'),
    fieldValueService: {} as never,
    resolveEntityDefinition: async () => ({
      id: 'def_1',
      entityType: 'vendor_part',
      apiSlug: 'vendor-parts',
    }),
    getFields: async () => fields as never,
    runPreHooks: async (_o, _d, values) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => ({ failures, changed: true, changes: [], instance: null }),
  }
}

const REJECTED = 'RecordId must be in format entityDefinitionId:entityInstanceId'

beforeEach(() => vi.clearAllMocks())

describe('createEntity when a field write is swallowed', () => {
  it('rolls the instance back and throws 422 when the lost field is required', async () => {
    const fields = [
      fieldRow('f_part', 'vendor_part_part', true),
      fieldRow('f_contact', 'vendor_part_contact', true),
      fieldRow('f_price', 'vendor_part_unit_price', false),
    ]

    await expect(
      createEntity(ctx(fields, [{ fieldId: 'f_contact', error: REJECTED }]), 'def_1', {
        vendor_part_part: 'def_part:part_1',
        // The bare id the relation materializer used to hand over.
        vendor_part_contact: 'company_1',
        vendor_part_unit_price: 1234,
      })
    ).rejects.toMatchObject({
      name: 'UnprocessableEntityError',
      message: `Could not write required field f_contact: ${REJECTED}`,
      details: { failedFields: ['vendor_part_contact'] },
    })

    // The stub is gone, not left behind as a record missing its supplier.
    expect(h.deleteEntityInstance).toHaveBeenCalledWith({ id: 'inst_1', organizationId: 'org_1' })
    // Nothing announced a record that no longer exists.
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.publishLater).not.toHaveBeenCalled()
  })

  it('keeps the lenient behaviour when the lost field is optional', async () => {
    const fields = [
      fieldRow('f_part', 'vendor_part_part', true),
      fieldRow('f_note', 'vendor_part_note', false),
    ]

    const result = await createEntity(
      ctx(fields, [{ fieldId: 'f_note', error: 'Invalid value' }]),
      'def_1',
      { vendor_part_part: 'def_part:part_1', vendor_part_note: 'x' }
    )

    expect(result.instance.id).toBe('inst_1')
    expect(h.deleteEntityInstance).not.toHaveBeenCalled()
  })

  it('names every required field that was lost', async () => {
    const fields = [
      fieldRow('f_part', 'vendor_part_part', true),
      fieldRow('f_contact', 'vendor_part_contact', true),
    ]

    await expect(
      createEntity(
        ctx(fields, [
          { fieldId: 'f_part', error: 'bad part' },
          { fieldId: 'f_contact', error: 'bad supplier' },
        ]),
        'def_1',
        { vendor_part_part: 'x', vendor_part_contact: 'y' }
      )
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof UnprocessableEntityError &&
        e.details.failedFields?.length === 2 &&
        e.message.includes('bad part') &&
        e.message.includes('bad supplier')
    )
  })
})
