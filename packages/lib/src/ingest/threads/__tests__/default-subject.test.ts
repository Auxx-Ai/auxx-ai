// packages/lib/src/ingest/threads/__tests__/default-subject.test.ts

import { describe, expect, it } from 'vitest'
import { defaultThreadSubject } from '../default-subject'

describe('defaultThreadSubject', () => {
  it('passes a real subject through untouched', () => {
    expect(defaultThreadSubject('Order #1043', 'google')).toBe('Order #1043')
    expect(defaultThreadSubject('Order #1043', 'openphone')).toBe('Order #1043')
  })

  it('falls back to "No Subject" on subject-carrying channels', () => {
    expect(defaultThreadSubject(null, 'google')).toBe('No Subject')
    expect(defaultThreadSubject(undefined, 'outlook')).toBe('No Subject')
    expect(defaultThreadSubject('', 'google')).toBe('No Subject')
  })

  it('stores a BLANK subject on channels that have no subject', () => {
    // This is the whole point: `resolveThreadTitle` only derives a participant title when the
    // stored subject is blank, so a literal 'No Subject' here pins every ingested SMS thread to
    // a meaningless title — which is exactly what shipped.
    expect(defaultThreadSubject(null, 'openphone')).toBe('')
    expect(defaultThreadSubject(undefined, 'openphone')).toBe('')
    expect(defaultThreadSubject('', 'openphone')).toBe('')
  })

  it('treats an unknown provider as subject-carrying', () => {
    // Email is the default. An unrecognised key must not silently blank thousands of existing
    // threads' titles.
    expect(defaultThreadSubject(null, 'something-new')).toBe('No Subject')
    expect(defaultThreadSubject(null, null)).toBe('No Subject')
    expect(defaultThreadSubject(null, undefined)).toBe('No Subject')
  })
})
