// packages/lib/src/companies/enrichment/__tests__/guards.test.ts
// `shouldEnrich` is the whole throttle policy, and it is pure — no db, no Redis, no
// doubles of any kind. Everything that decides whether a third-party website gets fetched
// is exercised here.

import { describe, expect, it } from 'vitest'
import { domainFromUrl, domainFromWebsite } from '../derive-domain'
import {
  type CompanyEnrichmentState,
  ENRICHED_TTL_MS,
  FAILED_TTL_MS,
  shouldEnrich,
} from '../guards'

const NOW = new Date('2026-09-02T12:00:00Z')

function state(overrides: Partial<CompanyEnrichmentState> = {}): CompanyEnrichmentState {
  return {
    domain: null,
    website: [],
    status: null,
    enrichedAt: null,
    name: null,
    notes: null,
    logoRef: null,
    ...overrides,
  }
}

const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('shouldEnrich — domain resolution', () => {
  it('enriches against the stored domain', () => {
    expect(shouldEnrich(state({ domain: 'acme.com' }), 'created', NOW)).toEqual({
      action: 'enrich',
      domain: 'acme.com',
      derivedFromWebsite: false,
    })
  })

  it('normalizes a stored domain that carries case or padding', () => {
    const decision = shouldEnrich(state({ domain: '  ACME.com ' }), 'created', NOW)
    expect(decision).toMatchObject({ action: 'enrich', domain: 'acme.com' })
  })

  // This is the whole point of the website door: before it, `company_domain` had exactly
  // one writer in the codebase (the mail ingest path), so a company that did not arrive by
  // email was unenrichable no matter what the user typed in.
  it('derives the domain from the website when none is stored', () => {
    expect(
      shouldEnrich(state({ website: ['https://www.mcmaster.com/about'] }), 'website-changed', NOW)
    ).toEqual({ action: 'enrich', domain: 'mcmaster.com', derivedFromWebsite: true })
  })

  it('prefers the stored domain over the website', () => {
    const decision = shouldEnrich(
      state({ domain: 'acme.com', website: ['https://other.com'] }),
      'created',
      NOW
    )
    expect(decision).toMatchObject({ domain: 'acme.com', derivedFromWebsite: false })
  })
})

describe('shouldEnrich — the domainless case', () => {
  // The 17 companies an import minted by name carried NO trace at all before this: the old
  // handler returned before even writing a status, so the gap was invisible in the UI.
  it('marks a company with neither domain nor website as skipped', () => {
    expect(shouldEnrich(state(), 'created', NOW)).toEqual({
      action: 'skip',
      why: 'no-domain',
      writeStatus: 'skipped',
    })
  })

  it('does not rewrite the marker on a company already marked skipped', () => {
    expect(shouldEnrich(state({ status: 'skipped' }), 'domain-changed', NOW)).toEqual({
      action: 'skip',
      why: 'no-domain',
      writeStatus: null,
    })
  })

  it('treats a blank or unusable website as no website', () => {
    for (const website of [[''], ['   '], ['not a url'], ['mailto:a@b.com'], ['https://']]) {
      expect(shouldEnrich(state({ website }), 'website-changed', NOW)).toMatchObject({
        action: 'skip',
        why: 'no-domain',
      })
    }
  })

  it('refuses a free-mail provider or an excluded TLD as a company website', () => {
    expect(shouldEnrich(state({ website: ['https://gmail.com'] }), 'created', NOW)).toMatchObject({
      why: 'no-domain',
    })
    expect(shouldEnrich(state({ website: ['https://mit.edu'] }), 'created', NOW)).toMatchObject({
      why: 'no-domain',
    })
  })
})

describe('shouldEnrich — freshness windows', () => {
  it('skips a company enriched inside the success window', () => {
    const s = state({
      domain: 'acme.com',
      status: 'enriched',
      enrichedAt: ago(ENRICHED_TTL_MS - 1),
    })
    expect(shouldEnrich(s, 'domain-changed', NOW)).toEqual({
      action: 'skip',
      why: 'recently-enriched',
      writeStatus: null,
    })
  })

  it('re-enriches once the success window has passed', () => {
    const s = state({
      domain: 'acme.com',
      status: 'enriched',
      enrichedAt: ago(ENRICHED_TTL_MS + 1),
    })
    expect(shouldEnrich(s, 'backfill', NOW)).toMatchObject({ action: 'enrich' })
  })

  it('skips a company whose site just failed', () => {
    const s = state({ domain: 'acme.com', status: 'failed', enrichedAt: ago(FAILED_TTL_MS - 1) })
    expect(shouldEnrich(s, 'created', NOW)).toMatchObject({ why: 'recently-failed' })
  })

  it('retries a failure once its shorter window has passed', () => {
    const s = state({ domain: 'acme.com', status: 'failed', enrichedAt: ago(FAILED_TTL_MS + 1) })
    expect(shouldEnrich(s, 'backfill', NOW)).toMatchObject({ action: 'enrich' })
  })

  // A worker that dies between the `pending` marker and the terminal write must not strand
  // the record. Concurrency is handled by the BullMQ jobId and the Redis claim, both of
  // which expire; a `pending` guard here would not.
  it('never treats pending as a reason to stay away', () => {
    expect(
      shouldEnrich(state({ domain: 'acme.com', status: 'pending' }), 'created', NOW)
    ).toMatchObject({ action: 'enrich' })
  })

  it('enriches a company that has a status but no timestamp', () => {
    expect(
      shouldEnrich(
        state({ domain: 'acme.com', status: 'enriched', enrichedAt: null }),
        'created',
        NOW
      )
    ).toMatchObject({ action: 'enrich' })
  })
})

describe('shouldEnrich — manual', () => {
  it('bypasses both freshness windows', () => {
    const fresh = state({ domain: 'acme.com', status: 'enriched', enrichedAt: NOW })
    expect(shouldEnrich(fresh, 'manual', NOW)).toMatchObject({ action: 'enrich' })
  })

  // Manual is an override on the WINDOWS, not on physics. There is still nothing to fetch.
  it('does not conjure a domain', () => {
    expect(shouldEnrich(state(), 'manual', NOW)).toMatchObject({ why: 'no-domain' })
  })
})

describe('domainFromWebsite', () => {
  it('accepts a bare host, a www host, and a full url', () => {
    expect(domainFromWebsite(['acme.com'])).toBe('acme.com')
    expect(domainFromWebsite(['www.acme.com'])).toBe('acme.com')
    expect(domainFromWebsite(['https://shop.acme.co.uk/x?y=1'])).toBe('acme.co.uk')
  })

  it('takes the first usable entry of a multi-value field', () => {
    expect(domainFromWebsite(['', 'not a url', 'https://acme.com'])).toBe('acme.com')
  })

  it('returns null for an empty or absent list', () => {
    expect(domainFromWebsite([])).toBeNull()
    expect(domainFromWebsite(null)).toBeNull()
    expect(domainFromWebsite(undefined)).toBeNull()
  })

  it('rejects non-http schemes rather than coercing them', () => {
    expect(domainFromUrl('mailto:sales@acme.com')).toBeNull()
    expect(domainFromUrl('ftp://acme.com')).toBeNull()
    expect(domainFromUrl('javascript:alert(1)')).toBeNull()
  })
})
