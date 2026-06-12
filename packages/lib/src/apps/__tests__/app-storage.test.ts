// packages/lib/src/apps/__tests__/app-storage.test.ts
//
// Covers the validation guards, which short-circuit (return err) before any DB
// access — so the database mock is never exercised on these paths. The DB
// behaviour (upsert/onConflict/expiry/cap) needs a real Postgres and is
// verified by the smoke test, not here (no DB harness in this package).

import { describe, expect, it, vi } from 'vitest'

vi.mock('@auxx/database', () => ({ AppStorage: {}, database: {} }))

import {
  getAppStorageValue,
  listAppStorageValues,
  setAppStorageValue,
  setAppStorageValueIfAbsent,
} from '../app-storage'

const INSTALL = 'inst_1'

describe('app-storage validation guards', () => {
  it('rejects an invalid key', async () => {
    const result = await getAppStorageValue(INSTALL, null, '', 'bad key!')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect((result.error as { statusCode?: number }).statusCode).toBe(400)
  })

  it('accepts keys with the allowed charset (proceeds past validation)', async () => {
    // A valid key passes validation and reaches the (mocked) DB, which throws —
    // proving the guard let it through rather than rejecting it.
    await expect(getAppStorageValue(INSTALL, null, '', 'a:b.c-d_1')).rejects.toBeDefined()
  })

  it('rejects an invalid collection name', async () => {
    const result = await setAppStorageValue(INSTALL, null, 'has space', 'k', { a: 1 }, null)
    expect(result.isErr()).toBe(true)
  })

  it('rejects a value over the 256 KB cap', async () => {
    const big = 'x'.repeat(256 * 1024 + 1)
    const result = await setAppStorageValue(INSTALL, null, '', 'k', big, null)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.message).toMatch(/exceeds/)
  })

  it('rejects an oversize value on setIfAbsent too', async () => {
    const big = { blob: 'x'.repeat(256 * 1024) }
    const result = await setAppStorageValueIfAbsent(INSTALL, null, '', 'k', big, null)
    expect(result.isErr()).toBe(true)
  })

  it('rejects listing an invalid collection', async () => {
    const result = await listAppStorageValues(INSTALL, null, 'no spaces allowed')
    expect(result.isErr()).toBe(true)
  })

  it('rejects a key longer than 255 chars', async () => {
    const result = await getAppStorageValue(INSTALL, null, '', 'a'.repeat(256))
    expect(result.isErr()).toBe(true)
  })

  it('rejects a collection longer than 64 chars', async () => {
    const result = await setAppStorageValue(INSTALL, null, 'a'.repeat(65), 'k', 1, null)
    expect(result.isErr()).toBe(true)
  })
})
