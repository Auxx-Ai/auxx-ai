// packages/lib/src/files/lifecycle/__tests__/attachment-maintenance.test.ts

/**
 * `lifecycle/attachment-maintenance.ts` — the two whole-organization sweeps
 * that moved off `AttachmentService`. **Zero `vi.mock` calls.**
 *
 * The statement counts are the point: both sweeps are fixed-cost (three
 * statements and one respectively) regardless of how many rows they find, and
 * both are organization-scoped on every statement including the `DELETE`.
 */

import { schema } from '@auxx/database'
import { describe, expect, it } from 'vitest'
import { makeCtx, makeDb, TEST_IDS } from '../../__tests__/support'
import { cleanupOrphanedAttachments, validateAttachmentIntegrity } from '../attachment-maintenance'

const TABLES = {
  Attachment: schema.Attachment,
  FileVersion: schema.FileVersion,
  FolderFile: schema.FolderFile,
  MediaAsset: schema.MediaAsset,
  MediaAssetVersion: schema.MediaAssetVersion,
}

describe('cleanupOrphanedAttachments', () => {
  it('scans both sides and deletes in one statement, however many orphans there are', async () => {
    const db = makeDb({
      select: [
        Array.from({ length: 40 }, (_, i) => ({ id: `att_file_${i}` })),
        Array.from({ length: 60 }, (_, i) => ({ id: `att_asset_${i}` })),
      ],
      tables: TABLES,
    })

    const result = await cleanupOrphanedAttachments(makeCtx({ db: db.db }))

    expect(result._unsafeUnwrap()).toBe(100)
    expect(db.journal.ops('db')).toEqual(['select', 'select', 'delete'])
  })

  it('does not issue a DELETE when nothing is orphaned', async () => {
    const db = makeDb({ select: [[], []], tables: TABLES })

    const result = await cleanupOrphanedAttachments(makeCtx({ db: db.db }))

    expect(result._unsafeUnwrap()).toBe(0)
    expect(db.deletes).toEqual([])
  })

  it('scopes the DELETE to the organization as well as the id list', async () => {
    // The legacy body deleted on the id list alone. The ids came from org-scoped
    // selects so it was never a live hole, but a sweep is the last place to rely
    // on that.
    const db = makeDb({ select: [[{ id: 'att_1' }], []], tables: TABLES })

    await cleanupOrphanedAttachments(makeCtx({ db: db.db, organizationId: 'org_owner' }))

    const where = JSON.stringify(db.wheres.at(-1)?.predicate)
    expect(where).toContain('org_owner')
    expect(where).toContain('att_1')
  })
})

describe('validateAttachmentIntegrity', () => {
  it('reports one error per violated rule and counts the row once', async () => {
    const db = makeDb({
      select: [
        [
          // Both sides set, and neither target exists: three violations, one row.
          {
            id: 'att_bad',
            fileId: 'ff_gone',
            fileVersionId: null,
            assetId: 'ast_gone',
            assetVersionId: null,
            fileExists: null,
            assetExists: null,
            fileVersionExists: null,
            assetVersionExists: null,
          },
          {
            id: 'att_good',
            fileId: null,
            fileVersionId: null,
            assetId: TEST_IDS.assetId,
            assetVersionId: null,
            fileExists: null,
            assetExists: TEST_IDS.assetId,
            fileVersionExists: null,
            assetVersionExists: null,
          },
        ],
      ],
      tables: TABLES,
    })

    const report = (await validateAttachmentIntegrity(makeCtx({ db: db.db })))._unsafeUnwrap()

    expect(report.validAttachments).toBe(1)
    expect(report.invalidAttachments).toBe(1)
    expect(report.errors).toEqual([
      'Attachment att_bad: Must have exactly one of file or asset reference',
      'Attachment att_bad: Referenced file ff_gone not found',
      'Attachment att_bad: Referenced asset ast_gone not found',
    ])
  })

  it('flags a dangling pinned version', async () => {
    const db = makeDb({
      select: [
        [
          {
            id: 'att_pinned',
            fileId: null,
            fileVersionId: null,
            assetId: 'ast_1',
            assetVersionId: 'av_gone',
            fileExists: null,
            assetExists: 'ast_1',
            fileVersionExists: null,
            assetVersionExists: null,
          },
        ],
      ],
      tables: TABLES,
    })

    const report = (await validateAttachmentIntegrity(makeCtx({ db: db.db })))._unsafeUnwrap()

    expect(report.errors).toEqual([
      'Attachment att_pinned: Referenced asset version av_gone not found',
    ])
  })

  it('reads once and never writes', async () => {
    const db = makeDb({ select: [[]], tables: TABLES })

    await validateAttachmentIntegrity(makeCtx({ db: db.db, organizationId: 'org_owner' }))

    expect(db.journal.ops('db')).toEqual(['select'])
    expect(JSON.stringify(db.wheres[0]?.predicate)).toContain('org_owner')
  })
})
