// packages/lib/src/files/__tests__/support-kit.test.ts

/**
 * Proves the `files/` support kit works — and, more importantly, proves the
 * property the whole refactor is for: **this file calls `vi.mock` zero times.**
 *
 * The two functions under test are written to the `ctx.ts` contract but live
 * here rather than in `src/`, because the contract is what is being tested, not
 * any particular piece of production behaviour.
 */

import type { Database, Transaction } from '@auxx/database'
import { schema } from '@auxx/database'
import type { MediaAssetEntity } from '@auxx/database/types'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import type { AuxxError } from '../../errors'
import { NotFoundError } from '../../errors'
import type { FilesCtx, FilesDeps } from '../ctx'
import { guard } from '../guard'
import {
  anAsset,
  makeCachePort,
  makeClock,
  makeCtx,
  makeDb,
  makeDeps,
  makeJournal,
  makeQueuePort,
  makeStoragePort,
  TEST_BUCKETS,
  TEST_IDS,
} from './support'

// ============= Functions written to the ctx.ts contract =============

/**
 * Signature shape 2 — database-touching, plus collaborators.
 *
 * Reads an asset, renders its public URL, and records the read downstream. Note
 * it never opens a transaction: `ctx.db` may already be one.
 */
async function describeDemoAsset(
  ctx: FilesCtx,
  deps: FilesDeps,
  input: { assetId: string; bucket: string }
): Promise<Result<{ url: string; seenAt: Date }, AuxxError>> {
  return guard(
    async () => {
      const asset = (await ctx.db.query.MediaAsset.findFirst({
        where: and(
          eq(schema.MediaAsset.id, input.assetId),
          eq(schema.MediaAsset.organizationId, ctx.organizationId)
        ),
      })) as MediaAssetEntity | undefined

      if (!asset) throw new NotFoundError(`Asset ${input.assetId} not found`)

      const url = deps.storage.buildExternalUrl({
        provider: 'S3',
        bucket: input.bucket,
        key: asset.name ?? asset.id,
      })

      await deps.cache.bust('files:asset.viewed', { assetId: asset.id })

      return { url, seenAt: deps.now() }
    },
    'Failed to describe demo asset',
    { assetId: input.assetId }
  )
}

/**
 * Signature shape 3 — transaction-only. `tx` is positional and first, so a pool
 * cannot be handed to it.
 */
async function markDemoAssetArchived(
  tx: Transaction,
  ctx: FilesCtx,
  input: { assetId: string; at: Date }
): Promise<void> {
  await tx
    .update(schema.MediaAsset)
    .set({ deletedAt: input.at, updatedAt: input.at })
    .where(
      and(
        eq(schema.MediaAsset.id, input.assetId),
        eq(schema.MediaAsset.organizationId, ctx.organizationId)
      )
    )
}

// ============= Tests =============

describe('files test-support kit', () => {
  it('drives a ctx + deps function with plain objects and records every call', async () => {
    const journal = makeJournal()
    const db = makeDb({
      query: { MediaAsset: [anAsset({ name: 'photo.png' })] },
      tables: { MediaAsset: schema.MediaAsset },
      journal,
    })
    const storage = makeStoragePort({
      journal,
      results: { buildExternalUrl: 'https://cdn.test/photo.png' },
    })
    const cache = makeCachePort({ journal })
    const clock = makeClock('2026-03-04T05:06:07.000Z')

    const ctx = makeCtx({ db: db.db })
    const deps = makeDeps({ storage: storage.port, cache: cache.port, now: clock.now })

    const result = await describeDemoAsset(ctx, deps, {
      assetId: TEST_IDS.assetId,
      bucket: TEST_BUCKETS.public,
    })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({
      url: 'https://cdn.test/photo.png',
      seenAt: new Date('2026-03-04T05:06:07.000Z'),
    })

    // The port double recorded the bucket it was given — the assertion that
    // #1816/#1817/#1818 were invisible without.
    expect(storage.callsTo('buildExternalUrl')[0]?.params).toEqual({
      provider: 'S3',
      bucket: TEST_BUCKETS.public,
      key: 'photo.png',
    })
    expect(cache.events()).toEqual(['files:asset.viewed'])
    expect(journal.ops()).toEqual(['query.findFirst', 'buildExternalUrl', 'bust'])
  })

  it('converts a thrown AuxxError into an err() through guard', async () => {
    const ctx = makeCtx({ db: makeDb({ query: { MediaAsset: [] } }).db })

    const result = await describeDemoAsset(ctx, makeDeps(), {
      assetId: 'ast_missing',
      bucket: TEST_BUCKETS.private,
    })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().statusCode).toBe(404)
    expect(result._unsafeUnwrapErr().message).toBe('Asset ast_missing not found')
  })

  it('interleaves db statements and port calls so BEGIN..COMMIT can be asserted', async () => {
    const journal = makeJournal()
    const db = makeDb({ tables: { MediaAsset: schema.MediaAsset }, journal })
    const queue = makeQueuePort({ journal, jobIds: ['job_cleanup'] })
    const cache = makeCachePort({ journal })
    const clock = makeClock()

    const ctx = makeCtx({ db: db.db })

    // The caller owns the transaction; lib functions never open one, because
    // `ctx.db` may already be inside one.
    await (db.db as Database).transaction(async (tx) => {
      await markDemoAssetArchived(
        tx,
        { ...ctx, db: tx },
        {
          assetId: TEST_IDS.assetId,
          at: clock.now(),
        }
      )
    })

    // Side effects strictly after COMMIT.
    const jobId = await queue.port.enqueueStorageCleanup({
      provider: 'S3',
      bucket: TEST_BUCKETS.private,
      key: 'photo.png',
      reason: 'asset archived',
    })
    await cache.port.bust('files:asset.archived', { assetId: TEST_IDS.assetId })

    expect(jobId).toBe('job_cleanup')
    expect(journal.ops()).toEqual(['begin', 'update', 'commit', 'enqueueStorageCleanup', 'bust'])

    // The Phase 6 assertion, in one line: nothing but SQL inside the transaction.
    expect(journal.between('begin', 'commit').every((e) => e.channel === 'db')).toBe(true)

    // `tableName` resolved the real name despite Drizzle tables being `{}` under Vitest.
    expect(db.updates).toEqual([
      {
        table: 'MediaAsset',
        values: { deletedAt: clock.now(), updatedAt: clock.now() },
      },
    ])
    expect(db.transactions).toBe(1)
  })

  it('records a rollback when the transaction body throws', async () => {
    const journal = makeJournal()
    const db = makeDb({ journal })

    await expect(
      (db.db as Database).transaction(async () => {
        throw new NotFoundError('boom')
      })
    ).rejects.toThrow('boom')

    expect(journal.ops('db')).toEqual(['begin', 'rollback'])
  })

  it('gives a deterministic, advanceable clock without fake timers', () => {
    const clock = makeClock('2026-01-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
    clock.advance(90_000)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z')
    expect(clock.millis()).toBe(new Date('2026-01-01T00:01:30.000Z').getTime())
  })
})
