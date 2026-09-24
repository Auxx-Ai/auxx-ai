// packages/lib/src/mail-unsubscribe/__tests__/one-click-post-guard.test.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  // A public-looking name that resolves to a private address (DNS rebinding).
  const lookup = vi.fn((_host: string, _opts: unknown, cb: (...a: unknown[]) => void) =>
    cb(null, [{ address: '10.0.0.5', family: 4 }])
  )
  return { ...actual, default: { ...actual, lookup }, lookup }
})

import { BlockedAddressError } from '../../net/safe-fetch'
import { postOneClickUnsubscribe } from '../one-click-post'

describe('postOneClickUnsubscribe default fetch', () => {
  it('refuses a public hostname that resolves to a private address', async () => {
    await expect(
      postOneClickUnsubscribe('https://list.rebind.example/u/abc')
    ).rejects.toBeInstanceOf(BlockedAddressError)
  })
})
