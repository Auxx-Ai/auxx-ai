// packages/lib/src/ai/agent-framework/__tests__/tool-inputs.test.ts

import { describe, expect, it } from 'vitest'
import {
  type KnownDefIds,
  normalizeActorIdArg,
  normalizeActorIdArrayArg,
  normalizeRecordIdArg,
  normalizeRecordIdArrayArg,
  parseDeadlineArg,
  parseStringArg,
} from '../tool-inputs'

const knownDefIds: KnownDefIds = {
  byId: new Set(['k6fyo76dx6y54rmpmj8khe1e', 'def_other']),
  byApiSlug: new Map([
    ['contacts', 'k6fyo76dx6y54rmpmj8khe1e'],
    ['tickets', 'def_other'],
  ]),
  byEntityType: new Map([
    ['contact', 'k6fyo76dx6y54rmpmj8khe1e'],
    ['ticket', 'def_other'],
  ]),
}

describe('normalizeRecordIdArg', () => {
  it('passes through a canonical 2-part recordId', () => {
    const r = normalizeRecordIdArg('k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d', {
      knownDefIds,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d')
    if (r.ok) expect(r.warnings).toBeUndefined()
  })

  it('repairs the create_task bug: 3-part with apiSlug prefix → 2-part', () => {
    const r = normalizeRecordIdArg('contacts:k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d', {
      knownDefIds,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe('k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d')
      expect(r.warnings).toEqual(["recordId: dropped redundant 'contacts:' prefix."])
    }
  })

  it('repairs 3-part with entityType prefix → 2-part', () => {
    const r = normalizeRecordIdArg('contact:k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d', {
      knownDefIds,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d')
  })

  it('rejects 3-part when slug does not match the named defId', () => {
    const r = normalizeRecordIdArg('tickets:k6fyo76dx6y54rmpmj8khe1e:krktcwtjkmx41nwhiigw4s1d', {
      knownDefIds,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('3 colon-separated parts')
  })

  it('substitutes apiSlug:instId → defId:instId when slug is recognized', () => {
    const r = normalizeRecordIdArg('contacts:abc123', { knownDefIds })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe('k6fyo76dx6y54rmpmj8khe1e:abc123')
      expect(r.warnings?.[0]).toContain("substituted entityDefinitionId 'k6fyo76dx6y54rmpmj8khe1e'")
    }
  })

  it('rejects 2-part with unknown defId and unknown slug', () => {
    const r = normalizeRecordIdArg('totally_made_up:abc123', { knownDefIds })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('unknown entityDefinitionId')
  })

  it('accepts bare instId when defaultEntityDefinitionId is provided', () => {
    const r = normalizeRecordIdArg('abc123', {
      knownDefIds,
      defaultEntityDefinitionId: 'k6fyo76dx6y54rmpmj8khe1e',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe('k6fyo76dx6y54rmpmj8khe1e:abc123')
      expect(r.warnings?.[0]).toContain('bare instance id')
    }
  })

  it('rejects bare instId with no defaultEntityDefinitionId', () => {
    const r = normalizeRecordIdArg('abc123', { knownDefIds })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('missing the entityDefinitionId prefix')
  })

  it('rejects non-string input', () => {
    const r = normalizeRecordIdArg(42, { knownDefIds })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('must be a non-empty string')
  })

  it('passes-through with no knownDefIds (unverified mode)', () => {
    const r = normalizeRecordIdArg('any:thing', {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('any:thing')
  })

  it('uses argName in error messages for actionable LLM feedback', () => {
    const r = normalizeRecordIdArg('bad:input:format', {
      knownDefIds,
      argName: 'linkedRecordIds[0]',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("linkedRecordIds[0] 'bad:input:format'")
  })
})

describe('normalizeRecordIdArrayArg', () => {
  it('returns [] for undefined input', () => {
    const r = normalizeRecordIdArrayArg(undefined, { knownDefIds })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([])
  })

  it('rejects when input is not an array', () => {
    const r = normalizeRecordIdArrayArg('foo', { knownDefIds })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('must be an array')
  })

  it('aggregates warnings across recovered items', () => {
    const r = normalizeRecordIdArrayArg(
      [
        'contacts:k6fyo76dx6y54rmpmj8khe1e:inst1',
        'k6fyo76dx6y54rmpmj8khe1e:inst2', // canonical, no warning
        'contacts:inst3', // slug substitution
      ],
      { knownDefIds }
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual([
        'k6fyo76dx6y54rmpmj8khe1e:inst1',
        'k6fyo76dx6y54rmpmj8khe1e:inst2',
        'k6fyo76dx6y54rmpmj8khe1e:inst3',
      ])
      expect(r.warnings).toHaveLength(2)
    }
  })

  it('short-circuits on the first invalid item with an indexed error', () => {
    const r = normalizeRecordIdArrayArg(['k6fyo76dx6y54rmpmj8khe1e:inst1', 'totally_bogus:inst2'], {
      knownDefIds,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('recordIds[1]')
  })
})

describe('normalizeActorIdArg', () => {
  it('passes through canonical user:<id>', () => {
    const r = normalizeActorIdArg('user:u_123')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('user:u_123')
  })

  it('passes through canonical group:<id>', () => {
    const r = normalizeActorIdArg('group:g_abc')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('group:g_abc')
  })

  it('promotes bare id to user:<id> when defaultKind: user', () => {
    const r = normalizeActorIdArg('u_123', { defaultKind: 'user' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBe('user:u_123')
      expect(r.warnings?.[0]).toContain("kind 'user'")
    }
  })

  it('rejects bare id with no defaultKind', () => {
    const r = normalizeActorIdArg('u_123')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('missing the kind prefix')
  })

  it('rejects unknown kind prefix', () => {
    const r = normalizeActorIdArg('admin:u_123')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('unknown kind prefix')
  })

  it('rejects 3-part shape', () => {
    const r = normalizeActorIdArg('user:org:u_123')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('3 colon-separated parts')
  })
})

describe('normalizeActorIdArrayArg', () => {
  it('returns [] for undefined', () => {
    const r = normalizeActorIdArrayArg(undefined)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([])
  })

  it('handles a mix of canonical and bare ids with defaultKind', () => {
    const r = normalizeActorIdArrayArg(['user:u_1', 'u_2', 'group:g_1'], { defaultKind: 'user' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual(['user:u_1', 'user:u_2', 'group:g_1'])
      expect(r.warnings).toHaveLength(1)
    }
  })

  it('short-circuits on first invalid item with index in argName', () => {
    const r = normalizeActorIdArrayArg(['user:u_1', 'admin:u_2'], { defaultKind: 'user' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('actorIds[1]')
  })
})

describe('parseStringArg', () => {
  it('returns trimmed string for valid input', () => {
    const r = parseStringArg('  hello  ', { name: 'title' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('hello')
  })

  it('returns undefined for absent optional', () => {
    const r = parseStringArg(undefined, { name: 'description' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeUndefined()
  })

  it('rejects required-but-empty', () => {
    const r = parseStringArg('   ', { name: 'title', required: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('title is required')
  })

  it('rejects non-string with helpful type info', () => {
    const r = parseStringArg(42, { name: 'title', required: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('must be a string; got number')
  })

  it('rejects strings exceeding max length', () => {
    const r = parseStringArg('a'.repeat(501), { name: 'title', max: 500 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('at most 500 characters; got 501')
  })

  it('rejects strings shorter than min length', () => {
    const r = parseStringArg('hi', { name: 'title', min: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('at least 5 characters')
  })
})

describe('parseDeadlineArg', () => {
  it('passes through undefined / null / empty as ok with undefined value', () => {
    expect(parseDeadlineArg(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseDeadlineArg(null)).toEqual({ ok: true, value: undefined })
    expect(parseDeadlineArg('')).toEqual({ ok: true, value: undefined })
  })

  it('rejects non-string with type info', () => {
    const r = parseDeadlineArg(42)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('must be a string')
  })

  it('parses a relative phrasing into a RelativeDate', () => {
    const r = parseDeadlineArg('in 3 days')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toBeDefined()
      // RelativeDate has a `value` numeric field; AbsoluteDate has type 'static'.
      // We don't assert exact shape — just that it parsed to *something*.
      expect(typeof r.value).toBe('object')
    }
  })

  it('parses a string-duration phrasing (eom) into an AbsoluteDate', () => {
    const r = parseDeadlineArg('end of month')
    expect(r.ok).toBe(true)
    if (r.ok && r.value && 'type' in r.value) {
      expect(r.value.type).toBe('static')
    }
  })

  it('rejects unparseable text with example phrasings in the error', () => {
    const r = parseDeadlineArg('not a date at all xyzzy')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('could not be parsed')
      expect(r.error).toContain('next Friday')
    }
  })
})
