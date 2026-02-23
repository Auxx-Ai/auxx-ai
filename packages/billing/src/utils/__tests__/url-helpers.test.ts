// packages/billing/src/utils/__tests__/url-helpers.test.ts

import { describe, expect, it } from 'vitest'
import { buildUrl } from '../url-helpers'

describe('buildUrl', () => {
  it('returns absolute URL unchanged when path starts with http', () => {
    expect(buildUrl('https://app.example.com', 'https://other.com/page')).toBe(
      'https://other.com/page'
    )
  })

  it('returns absolute URL unchanged when path starts with http (non-https)', () => {
    expect(buildUrl('https://app.example.com', 'http://other.com/page')).toBe(
      'http://other.com/page'
    )
  })

  it('joins base and path correctly', () => {
    expect(buildUrl('https://app.example.com', '/billing')).toBe('https://app.example.com/billing')
  })

  it('handles trailing slash on base', () => {
    expect(buildUrl('https://app.example.com/', '/billing')).toBe('https://app.example.com/billing')
  })

  it('handles missing leading slash on path', () => {
    expect(buildUrl('https://app.example.com', 'billing')).toBe('https://app.example.com/billing')
  })

  it('handles both trailing slash on base and missing leading slash on path', () => {
    expect(buildUrl('https://app.example.com/', 'billing/portal')).toBe(
      'https://app.example.com/billing/portal'
    )
  })
})
