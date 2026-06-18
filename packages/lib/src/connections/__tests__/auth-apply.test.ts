// packages/lib/src/connections/__tests__/auth-apply.test.ts

import { describe, expect, it } from 'vitest'
import { applyAuth } from '../auth-apply'

const req = () => ({ headers: {} as Record<string, string>, url: 'https://api.example.com/v1' })

describe('applyAuth', () => {
  it('applies a bearer token to the Authorization header', () => {
    const out = applyAuth(
      req(),
      { value: 'tok123' },
      {
        in: 'header',
        name: 'Authorization',
        format: 'Bearer {value}',
      }
    )
    expect(out.headers.Authorization).toBe('Bearer tok123')
  })

  it('applies a custom header with templated name + value (httpHeaderAuth)', () => {
    const out = applyAuth(
      req(),
      { value: 'secret-key', fields: { name: 'X-API-Key', value: 'secret-key' } },
      { in: 'header', name: '{name}', format: '{value}' }
    )
    expect(out.headers['X-API-Key']).toBe('secret-key')
  })

  it('builds a Basic auth header from user/password fields', () => {
    const out = applyAuth(
      req(),
      { value: '', fields: { user: 'u', password: 'p' } },
      { in: 'basic' }
    )
    expect(out.headers.Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })

  it('appends a query param for query auth', () => {
    const out = applyAuth(req(), { value: 'k' }, { in: 'query', name: 'api_key' })
    expect(out.url).toBe('https://api.example.com/v1?api_key=k')
  })

  it('appends with & when the url already has a query string', () => {
    const base = { headers: {}, url: 'https://x.test/p?a=1' }
    const out = applyAuth(base, { value: 'k' }, { in: 'query', name: 'key' })
    expect(out.url).toBe('https://x.test/p?a=1&key=k')
  })

  it('is a no-op when the spec is null (DB/email connections)', () => {
    const input = req()
    const out = applyAuth(input, { value: 'x' }, null)
    expect(out).toEqual(input)
  })

  it('does not mutate the input request', () => {
    const input = req()
    applyAuth(
      input,
      { value: 't' },
      { in: 'header', name: 'Authorization', format: 'Bearer {value}' }
    )
    expect(input.headers).toEqual({})
  })
})
