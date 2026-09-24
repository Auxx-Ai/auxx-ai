// packages/lib/src/net/__tests__/safe-fetch.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BadRequestError } from '../../errors'
import { BlockedAddressError, safeFetch } from '../safe-fetch'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('lib safeFetch', () => {
  it('maps a blocked address to a BadRequestError subclass', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const error = await safeFetch('http://169.254.169.254/latest').catch((e) => e)
    expect(error).toBeInstanceOf(BlockedAddressError)
    expect(error).toBeInstanceOf(BadRequestError)
    expect(error.message).toContain('169.254.169.254')
  })

  it('maps a refused URL to BadRequestError', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toBeInstanceOf(BadRequestError)
  })
})
