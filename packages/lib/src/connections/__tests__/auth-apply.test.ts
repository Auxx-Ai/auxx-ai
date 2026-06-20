// packages/lib/src/connections/__tests__/auth-apply.test.ts

import { describe, expect, it } from 'vitest'
import { applyAuth, BEARER_AUTH, defaultAuthApply } from '../auth-apply'

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

  describe('defaultAuthApply', () => {
    it('defaults oauth2-code to a bearer token', () => {
      expect(defaultAuthApply('oauth2-code')).toEqual(BEARER_AUTH)
    })

    it('defaults a server-minted client-credentials token to a bearer token', () => {
      expect(defaultAuthApply('client-credentials')).toEqual(BEARER_AUTH)
    })

    it('has no default for secret connections (they declare their own)', () => {
      expect(defaultAuthApply('secret')).toBeNull()
    })
  })

  describe('superset — multi-insertion + static headers', () => {
    it('applies multiple insertions in order (Supabase apikey + Authorization)', () => {
      const out = applyAuth(
        req(),
        { value: 'service-key' },
        {
          insertions: [
            { in: 'header', name: 'apikey', format: '{value}' },
            { in: 'header', name: 'Authorization', format: 'Bearer {value}' },
          ],
        }
      )
      expect(out.headers.apikey).toBe('service-key')
      expect(out.headers.Authorization).toBe('Bearer service-key')
    })

    it('merges constant static headers verbatim (Notion-Version)', () => {
      const out = applyAuth(
        req(),
        { value: 'tok' },
        {
          insertions: [{ in: 'header', name: 'Authorization', format: 'Bearer {value}' }],
          headers: { 'Notion-Version': '2022-06-28' },
        }
      )
      expect(out.headers.Authorization).toBe('Bearer tok')
      expect(out.headers['Notion-Version']).toBe('2022-06-28')
    })

    it('does not interpolate static headers (they are constants)', () => {
      const out = applyAuth(
        req(),
        { value: 'tok', fields: { x: 'leak' } },
        {
          insertions: [],
          headers: { 'X-Static': '{value} {x}' },
        }
      )
      expect(out.headers['X-Static']).toBe('{value} {x}')
    })

    it('basic auth reads custom userField/passwordField', () => {
      const out = applyAuth(
        req(),
        { value: '', fields: { account_sid: 'AC1', auth_token: 'tok' } },
        { in: 'basic', userField: 'account_sid', passwordField: 'auth_token' }
      )
      expect(out.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`)
    })

    it('query insertion supports a format template', () => {
      const out = applyAuth(
        req(),
        { value: 'k', fields: { env: 'prod' } },
        { in: 'query', name: 'token', format: '{value}-{env}' }
      )
      expect(out.url).toBe('https://api.example.com/v1?token=k-prod')
    })
  })
})
