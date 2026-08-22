// packages/lib/src/files/attachments/__tests__/attachment-mutations.test.ts

/**
 * `attachments/attachment-mutations.ts` — the write half of what
 * `AttachmentService` was. **Zero `vi.mock` calls**, as with every test written
 * to the `files/` contract.
 *
 * The assertions worth having here are the ones the legacy code could not make:
 * the file/asset XOR is a `BadRequestError` rather than a bare `Error`, the
 * organization on the row comes from `ctx` and never from the payload, and the
 * update path writes a closed set of columns instead of spreading an `any`.
 */

import { schema } from '@auxx/database'
import type { AttachmentEntity } from '@auxx/database/types'
import { describe, expect, it } from 'vitest'
import { BadRequestError, NotFoundError } from '../../../errors'
import { makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import {
  assertExactlyOneTarget,
  createAttachment,
  deleteAttachment,
  updateAttachment,
} from '../attachment-mutations'

const TABLES = { Attachment: schema.Attachment }

const AT = new Date('2026-01-01T00:00:00.000Z')

function anAttachment(overrides: Partial<AttachmentEntity> = {}): AttachmentEntity {
  return {
    id: 'att_1',
    organizationId: TEST_IDS.organizationId,
    entityType: 'MESSAGE',
    entityId: 'msg_1',
    role: 'ATTACHMENT',
    title: 'invoice.pdf',
    caption: null,
    sort: 1,
    fileId: null,
    fileVersionId: null,
    assetId: TEST_IDS.assetId,
    assetVersionId: null,
    contentId: null,
    createdById: TEST_IDS.userId,
    createdAt: AT,
    ...overrides,
  }
}

describe('assertExactlyOneTarget', () => {
  it('refuses both sides at once', () => {
    expect(() =>
      assertExactlyOneTarget({
        entityType: 'MESSAGE',
        entityId: 'msg_1',
        fileId: 'ff_1',
        assetId: 'ast_1',
      })
    ).toThrow(BadRequestError)
  })

  it('refuses neither side', () => {
    expect(() => assertExactlyOneTarget({ entityType: 'MESSAGE', entityId: 'msg_1' })).toThrow(
      BadRequestError
    )
  })

  it('refuses a version id without its own parent id', () => {
    expect(() =>
      assertExactlyOneTarget({
        entityType: 'MESSAGE',
        entityId: 'msg_1',
        fileVersionId: 'fv_1',
      })
    ).toThrow(BadRequestError)
    expect(() =>
      assertExactlyOneTarget({
        entityType: 'MESSAGE',
        entityId: 'msg_1',
        assetVersionId: 'av_1',
      })
    ).toThrow(BadRequestError)
  })

  it('accepts one side with its version pinned', () => {
    expect(() =>
      assertExactlyOneTarget({
        entityType: 'MESSAGE',
        entityId: 'msg_1',
        assetId: 'ast_1',
        assetVersionId: 'av_1',
      })
    ).not.toThrow()
  })
})

describe('createAttachment', () => {
  it('takes the organization from ctx, never from the payload', async () => {
    const db = makeDb({ select: [[]], insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db, organizationId: 'org_owner' }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_1',
    })

    expect(db.inserts[0]?.values).toMatchObject({ organizationId: 'org_owner' })
  })

  it('defaults role to ATTACHMENT and picks the next sort position', async () => {
    const db = makeDb({ select: [[{ sort: 7 }]], insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_1',
    })

    expect(db.inserts[0]?.values).toMatchObject({ role: 'ATTACHMENT', sort: 8 })
  })

  it('starts sort at 1 on a host with no attachments yet', async () => {
    const db = makeDb({ select: [[]], insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db }), {
      entityType: 'COMMENT',
      entityId: 'cmt_1',
      fileId: 'ff_1',
    })

    expect(db.inserts[0]?.values).toMatchObject({ sort: 1 })
  })

  it('skips the sort lookup when the caller supplies a position', async () => {
    const db = makeDb({ insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_1',
      sort: 3,
    })

    expect(db.journal.ops('db')).toEqual(['insert'])
  })

  it('scopes the sort lookup to the organization and the host', async () => {
    const db = makeDb({ select: [[]], insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db, organizationId: 'org_owner' }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_1',
    })

    const where = JSON.stringify(db.wheres[0]?.predicate)
    expect(where).toContain('org_owner')
    expect(where).toContain('msg_1')
  })

  it('honours a caller-supplied id, for deterministic inbound-mail creation', async () => {
    const db = makeDb({ select: [[]], insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db }), {
      id: 'att_deterministic',
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_1',
    })

    expect(db.inserts[0]?.values).toMatchObject({ id: 'att_deterministic' })
  })

  it('omits id entirely when none is supplied, so the column default applies', async () => {
    const db = makeDb({ select: [[]], insert: [[anAttachment()]], tables: TABLES })

    await createAttachment(makeCtx({ db: db.db }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_1',
    })

    expect(Object.hasOwn(db.inserts[0]?.values as object, 'id')).toBe(false)
  })

  it('is a 400, not a 500, when the target is malformed', async () => {
    const db = makeDb({ tables: TABLES })

    const result = await createAttachment(makeCtx({ db: db.db }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      fileId: 'ff_1',
      assetId: 'ast_1',
    })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    // Rejected before anything was written.
    expect(db.inserts).toEqual([])
  })

  it('names the target when the insert returns nothing, which means a foreign key failure', async () => {
    const db = makeDb({ select: [[]], insert: [[]], tables: TABLES })

    const result = await createAttachment(makeCtx({ db: db.db }), {
      entityType: 'MESSAGE',
      entityId: 'msg_1',
      assetId: 'ast_missing',
    })

    expect(result._unsafeUnwrapErr().message).toContain("MediaAsset 'ast_missing'")
  })
})

describe('updateAttachment', () => {
  it('writes only the fields the input names', async () => {
    const db = makeDb({
      select: [[anAttachment()]],
      update: [[anAttachment({ caption: 'front door' })]],
      tables: TABLES,
    })

    await updateAttachment(makeCtx({ db: db.db }), 'att_1', { caption: 'front door' })

    expect(db.updates[0]?.values).toEqual({ caption: 'front door' })
  })

  it('treats caption null as a clear and caption undefined as untouched', async () => {
    const cleared = makeDb({
      select: [[anAttachment()]],
      update: [[anAttachment()]],
      tables: TABLES,
    })
    await updateAttachment(makeCtx({ db: cleared.db }), 'att_1', { caption: null })
    expect(cleared.updates[0]?.values).toEqual({ caption: null })

    const untouched = makeDb({
      select: [[anAttachment()]],
      update: [[anAttachment()]],
      tables: TABLES,
    })
    await updateAttachment(makeCtx({ db: untouched.db }), 'att_1', { title: 'renamed' })
    expect(untouched.updates[0]?.values).toEqual({ title: 'renamed' })
  })

  it('refuses an empty patch rather than emitting SET with nothing in it', async () => {
    const db = makeDb({ select: [[anAttachment()]], tables: TABLES })

    const result = await updateAttachment(makeCtx({ db: db.db }), 'att_1', {})

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
    expect(db.updates).toEqual([])
  })

  it('scopes both the existence check and the UPDATE to the organization', async () => {
    const db = makeDb({
      select: [[anAttachment()]],
      update: [[anAttachment()]],
      tables: TABLES,
    })

    await updateAttachment(makeCtx({ db: db.db, organizationId: 'org_owner' }), 'att_1', {
      sort: 4,
    })

    expect(JSON.stringify(db.wheres[0]?.predicate)).toContain('org_owner')
    expect(JSON.stringify(db.wheres[1]?.predicate)).toContain('org_owner')
  })

  it('is a 404 for a row in another organization', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await updateAttachment(makeCtx({ db: db.db }), 'att_elsewhere', { sort: 1 })

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('deleteAttachment', () => {
  it('deletes with the organization in the predicate, not the id alone', async () => {
    // The legacy `detachFromEntity` deleted on `eq(id, …)` with no organization
    // filter at all — a cross-tenant delete to anyone holding an id. That method
    // is gone; this is the only delete path left, and it is scoped.
    const db = makeDb({ select: [[anAttachment()]], tables: TABLES })

    await deleteAttachment(makeCtx({ db: db.db, organizationId: 'org_owner' }), 'att_1')

    expect(db.deletes).toEqual([{ table: 'Attachment' }])
    const where = JSON.stringify(db.wheres.at(-1)?.predicate)
    expect(where).toContain('org_owner')
    expect(where).toContain('att_1')
  })

  it('is a 404 for a row that does not exist, and writes nothing', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    const result = await deleteAttachment(makeCtx({ db: db.db }), 'att_missing')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(db.deletes).toEqual([])
  })
})
